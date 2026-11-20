import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import { generateRequestDetails, setVapidDetails } from "npm:web-push@4.0.0";

const appOrigin = "https://santiagominacampo0-bit.github.io";
const appUrl = appOrigin + "/saldo-finanzas/";
const allowedOrigins = new Set([appOrigin, "http://localhost:4173"]);
const maxDevices = 5;
const maxBodyBytes = 512;
const reminderBatchSize = 24;
const reminderConcurrency = 4;
const pushTimeoutMs = 5000;

const messages = {
  test: { title: "Saldo · Aviso de prueba", body: "Los avisos están activados en este dispositivo." },
  budget_80: { title: "Saldo · Presupuesto", body: "Te acercas al límite de un presupuesto. Abre Saldo para revisarlo." },
  budget_100: { title: "Saldo · Presupuesto", body: "Alcanzaste el límite de un presupuesto. Abre Saldo para revisarlo." },
  monthly: { title: "Saldo · Recordatorio", body: "Tómate un momento para revisar tus movimientos y presupuestos." },
} as const;

type UserKind = "test" | "budget_80" | "budget_100";
type Kind = keyof typeof messages;
type PushRow = { endpoint: string; p256dh: string; auth: string };
type Reminder = { user_id: string; reminder_month: string; attempt_count: number };
type Admin = ReturnType<typeof makeAdmin>;

function makeAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Base de datos sin configurar.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function configureVapid() {
  const subject = Deno.env.get("VAPID_SUBJECT");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!subject || !publicKey || !privateKey) return false;
  setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(body: object, status: number, origin: string | null, extraHeaders = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(origin), ...extraHeaders } });
}

function matchesCronSecret(provided: string, expected: string) {
  if (expected.length < 32 || provided.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

async function readUserKind(request: Request): Promise<UserKind | null> {
  if (!request.headers.get("Content-Type")?.match(/^application\/json(?:;|$)/i)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let json = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      json += decoder.decode(value, { stream: true });
    }
    const kind = JSON.parse(json + decoder.decode())?.kind;
    return kind === "test" || kind === "budget_80" || kind === "budget_100" ? kind : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function trustedEndpoint(endpoint: string) {
  if (endpoint.length > 2048 || /[\s\\]/u.test(endpoint)) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.pathname === "/") {
    return null;
  }
  if (url.hostname === "fcm.googleapis.com") {
    return url.pathname.startsWith("/fcm/send/") && url.pathname.length > "/fcm/send/".length ? url : null;
  }
  if (url.hostname === "updates.push.services.mozilla.com") {
    return /^\/wpush\/v[12]\/.+/.test(url.pathname) ? url : null;
  }
  if (url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com")) return url;
  return null;
}

function validSubscription(row: PushRow) {
  return trustedEndpoint(row.endpoint) && /^B[A-Za-z0-9_-]{86}$/.test(row.p256dh) && /^[A-Za-z0-9_-]{22}$/.test(row.auth);
}

async function deliverToDevice(row: PushRow, kind: Kind) {
  const endpoint = trustedEndpoint(row.endpoint);
  if (!endpoint || !validSubscription(row)) return "invalid";

  let details;
  try {
    details = generateRequestDetails({
      endpoint: endpoint.href,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }, JSON.stringify({ ...messages[kind], url: appUrl, tag: "saldo-" + kind }), {
      contentEncoding: "aes128gcm",
      TTL: kind === "test" ? 300 : 86400,
    });
  } catch {
    return "invalid";
  }

  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(details.headers)) {
      if (name.toLowerCase() !== "content-length") headers.set(name, String(value));
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(details.body),
      redirect: "error",
      signal: AbortSignal.timeout(pushTimeoutMs),
    });
    await response.body?.cancel();
    if (response.ok) return "sent";
    return response.status === 404 || response.status === 410 ? "invalid" : "transient";
  } catch {
    return "transient";
  }
}

async function deliverToUser(admin: Admin, userId: string, kind: Kind) {
  const { data, error } = await admin.from("push_subscriptions")
    .select("endpoint,p256dh,auth").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(maxDevices);
  if (error) throw new Error("No se pudieron consultar los dispositivos.");

  const rows = (data || []) as PushRow[];
  const outcomes = await Promise.all(rows.map((row) => deliverToDevice(row, kind)));
  const invalid = rows.filter((_, index) => outcomes[index] === "invalid").map((row) => row.endpoint);
  if (invalid.length) {
    const { error: deleteError } = await admin.from("push_subscriptions")
      .delete().eq("user_id", userId).in("endpoint", invalid);
    if (deleteError) console.error("No se pudieron retirar suscripciones vencidas.");
  }

  return {
    sent: outcomes.filter((outcome) => outcome === "sent").length,
    transientFailures: outcomes.filter((outcome) => outcome === "transient").length,
    subscriptions: rows.length,
  };
}

async function deliverReminder(admin: Admin, reminder: Reminder) {
  const result = await deliverToUser(admin, reminder.user_id, "monthly");
  // If no device accepted the alert, the four-minute lease lets a later cron run retry.
  // After a partial delivery, avoid sending a duplicate to devices that accepted it.
  if (result.sent || !result.transientFailures) {
    const { error } = await admin.from("push_reminder_dispatches")
      .update({ completed_at: new Date().toISOString() })
      .eq("user_id", reminder.user_id).eq("reminder_month", reminder.reminder_month)
      .eq("reminder_type", "monthly").eq("attempt_count", reminder.attempt_count);
    if (error) console.error("No se pudo marcar un recordatorio como completado.");
  }
  return result.sent;
}

async function dispatchMonthlyReminders(admin: Admin) {
  const { data, error } = await admin.rpc("saldo_claim_due_push_reminders", { p_limit: reminderBatchSize });
  if (error) throw new Error("No se pudieron reservar recordatorios.");
  const reminders = (data || []) as Reminder[];
  let sent = 0;
  for (let start = 0; start < reminders.length; start += reminderConcurrency) {
    const batch = reminders.slice(start, start + reminderConcurrency);
    const results = await Promise.allSettled(batch.map((reminder) => deliverReminder(admin, reminder)));
    for (const result of results) {
      if (result.status === "fulfilled") sent += result.value;
      else console.error("No se pudo entregar un recordatorio.");
    }
  }
  return sent;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) return reply({ error: "Origen no permitido." }, 403, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return reply({ error: "Método no permitido." }, 405, origin, { Allow: "POST, OPTIONS" });

  try {
    const cronToken = request.headers.get("x-saldo-cron-secret");
    if (cronToken !== null) {
      const expected = Deno.env.get("SALDO_CRON_SECRET") || "";
      if (origin || !matchesCronSecret(cronToken, expected)) return reply({ error: "Credencial inválida." }, 401, origin);
      if (!configureVapid()) return reply({ error: "Avisos push todavía por configurar." }, 503, origin);
      const sent = await dispatchMonthlyReminders(makeAdmin());
      return reply({ ok: true, sent }, 200, origin);
    }

    const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i)?.[1];
    if (!token) return reply({ error: "Inicia sesión para enviar avisos." }, 401, origin);
    const admin = makeAdmin();
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user || user.role !== "authenticated" || user.is_anonymous) {
      return reply({ error: "La sesión no es válida." }, 401, origin);
    }

    const kind = await readUserKind(request);
    if (!kind) return reply({ error: "Tipo de aviso inválido." }, 400, origin);
    if (!configureVapid()) return reply({ error: "Avisos push todavía por configurar." }, 503, origin);
    const { data: quota, error: quotaError } = await admin.rpc("saldo_claim_push_quota", { p_user_id: user.id });
    if (quotaError) throw new Error("No se pudo comprobar la cuota de avisos.");
    if (!quota) return reply({ error: "Espera unos minutos antes de enviar más avisos." }, 429, origin, { "Retry-After": "300" });

    const result = await deliverToUser(admin, user.id, kind);
    if (!result.sent && result.transientFailures) {
      return reply({ error: "No se pudieron entregar los avisos ahora." }, 502, origin);
    }
    return reply({ ok: true, ...result }, 200, origin);
  } catch {
    return reply({ error: "No se pudo procesar el aviso." }, 500, origin);
  }
});
