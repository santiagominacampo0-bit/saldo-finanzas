import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { beforeEach, test } from "node:test";

const origin = "https://santiagominacampo0-bit.github.io";
const session = "header.payload.signature";
const userId = "10000000-0000-0000-0000-000000000001";
const fakeCronSecret = "f".repeat(64);
const vaultPair = { public_key: "B" + "v".repeat(86), private_key: "p".repeat(43) };
const generatedPair = { publicKey: "B" + "c".repeat(86), privateKey: "k".repeat(43) };
const env = {
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "fake-server-key",
};

let handler;
let scenario;
globalThis.Deno = { env: { get: (name) => scenario.env[name] }, serve: (fn) => { handler = fn; } };
globalThis.testPushLibrary = {
  generateRequestDetails: (_subscription, payload, options) => {
    assert.deepEqual(options.vapidDetails, {
      subject: origin + "/saldo-finanzas/", publicKey: vaultPair.public_key, privateKey: vaultPair.private_key,
    });
    return { body: new TextEncoder().encode(payload), headers: { "content-type": "application/octet-stream" } };
  },
  generateVAPIDKeys: () => { scenario.keyGenerations++; return generatedPair; },
};
globalThis.testSupabase = {
  auth: {
    async getUser(token) {
      assert.equal(token, session);
      return { data: { user: scenario.user } };
    },
  },
  async rpc(name, params) {
    scenario.calls.push({ name, params });
    if (name === "saldo_get_cron_token") return { data: fakeCronSecret };
    if (name === "saldo_get_or_initialize_vapid") {
      if (scenario.vaultError) return { error: { message: "simulated vault failure" } };
      if (params) scenario.vaultPair = vaultPair;
      return { data: scenario.vaultPair ? [scenario.vaultPair] : [] };
    }
    if (name === "saldo_claim_push_quota") return { data: scenario.quota };
    if (name === "saldo_claim_due_push_reminders") return { data: scenario.reminders };
    if (name === "saldo_claim_due_recurring_reminders") {
      if (scenario.recurringError) return { error: { message: "simulated database failure" } };
      return { data: scenario.recurringReminders };
    }
    throw new Error("RPC desconocido " + name);
  },
  from(table) {
    const filters = {};
    return {
      select() { return this; },
      order() { return this; },
      eq(key, value) { filters[key] = value; return this; },
      async limit(count) {
        assert.equal(table, "push_subscriptions");
        assert.equal(filters.user_id, userId);
        assert.equal(count, 5);
        return { data: scenario.rows.slice(0, count) };
      },
      delete() { return this; },
      async in(key, values) {
        assert.equal(table, "push_subscriptions");
        assert.equal(key, "endpoint");
        assert.equal(filters.user_id, userId);
        scenario.deleted.push(...values);
        return {};
      },
      update(values) {
        assert.ok(["push_reminder_dispatches", "push_recurring_dispatches"].includes(table));
        scenario.completed.push({ table, values, filters });
        return this;
      },
    };
  },
};

const packageMocks = new Map([
  ["npm:@supabase/supabase-js@2.119.2", "export const createClient = () => globalThis.testSupabase;"],
  ["npm:web-push@4.0.0", "export const { generateRequestDetails, generateVAPIDKeys } = globalThis.testPushLibrary;"],
]);
const entry = new URL("./index.ts", import.meta.url).href;
const require = createRequire(import.meta.url);

registerHooks({
  load(url, context, loadNext) {
    if (!url.startsWith(entry + "?case=")) return loadNext(url, context);
    const source = readFileSync(new URL(entry), "utf8");
    let code;
    try {
      code = stripTypeScriptTypes(source);
    } catch (error) {
      if (error.code !== "ERR_NO_TYPESCRIPT") throw error;
      // Ubuntu's Node build can omit the built-in TypeScript parser.
      code = require("@babel/core").transformSync(source, {
        filename: "index.ts",
        babelrc: false,
        configFile: false,
        plugins: [require("@babel/plugin-transform-typescript")],
      }).code;
    }
    return { format: "module", source: code, shortCircuit: true };
  },
  resolve(specifier, context, resolveNext) {
    const body = packageMocks.get(specifier);
    return body ? { url: "data:text/javascript," + encodeURIComponent(body), shortCircuit: true }
      : resolveNext(specifier, context);
  },
});
let caseNumber = 0;
beforeEach(async () => {
  scenario = {
    env: { ...env },
    user: { id: userId, role: "authenticated" },
    rows: [],
    quota: true,
    reminders: [],
    recurringReminders: [],
    recurringError: false,
    completed: [],
    providerStatus: 201,
    vaultPair,
    vaultError: false,
    keyGenerations: 0,
    calls: [],
    deleted: [],
    fetches: [],
  };

  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    scenario.fetches.push({ url: url.href, payload: JSON.parse(new TextDecoder().decode(options.body)) });
    return new Response(null, { status: scenario.providerStatus });
  };
  await import(entry + "?case=" + ++caseNumber);
});

function request({ body = '{"kind":"test"}', token = session, method = "POST", from = origin,
  type = "application/json", cron = null } = {}) {
  const headers = {};
  if (type) headers["Content-Type"] = type;
  if (from) headers.Origin = from;
  if (token) headers.Authorization = "Bearer " + token;
  if (cron !== null) headers["x-saldo-cron-secret"] = cron;
  return new Request("https://example.invalid/functions/v1/saldo-notify", {
    method, headers, body: method === "POST" ? body : undefined,
  });
}

function subscription(endpoint) {
  return { endpoint, p256dh: "B" + "a".repeat(86), auth: "a".repeat(22) };
}

test("accepts preflight for Saldo and emits only the matching CORS origin", async () => {
  const response = await handler(request({ method: "OPTIONS", token: null }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.deepEqual(scenario.calls, []);
});

test("rejects requests from unrelated browser origins and unsupported methods", async () => {
  const crossOrigin = await handler(request({ from: "https://example.com" }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await handler(request({ method: "GET" }))).status, 405);
  assert.deepEqual(scenario.calls, []);
});

test("requires a valid signed-in personal account before consuming quota", async () => {
  assert.equal((await handler(request({ token: null }))).status, 401);
  assert.equal((await handler(request({ token: "sb_publishable_fake" }))).status, 401);
  scenario.user = { id: userId, role: "authenticated", is_anonymous: true };
  assert.equal((await handler(request())).status, 401);
  scenario.user = null;
  assert.equal((await handler(request())).status, 401);
  assert.deepEqual(scenario.calls, []);
});

test("rejects malformed, oversized, non-JSON, and unauthorized reminder payloads", async () => {
  const requests = [
    request({ body: "{" }),
    request({ body: '{"kind":"monthly"}' }),
    request({ body: '{"kind":"recurring"}' }),
    request({ body: '{"kind":"test","data":"' + "a".repeat(600) + '"}' }),
    request({ body: '{"kind":"test"}', type: "text/plain" }),
  ];
  for (const input of requests) assert.equal((await handler(input)).status, 400);
  assert.deepEqual(scenario.calls, []);
});

test("withholds configuration from unauthenticated callers and hides vault failures", async () => {
  const body = '{"kind":"configuration"}';
  assert.equal((await handler(request({ token: null, body }))).status, 401);
  scenario.vaultError = true;
  const failure = await handler(request({ body }));
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: "No se pudo procesar el aviso." });
  assert.deepEqual(scenario.calls, [{ name: "saldo_get_or_initialize_vapid", params: undefined }]);
  scenario.vaultError = false;
  const retried = await handler(request({ body }));
  assert.deepEqual(await retried.json(), { ok: true, vapidPublicKey: vaultPair.public_key });
});

test("initializes VAPID once across concurrent requests and returns only the saved public key", async () => {
  scenario.vaultPair = null;
  const body = '{"kind":"configuration"}';
  const responses = await Promise.all([handler(request({ body })), handler(request({ body }))]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, vapidPublicKey: vaultPair.public_key });
  }
  assert.equal(scenario.keyGenerations, 1);
  assert.deepEqual(scenario.calls, [
    { name: "saldo_get_or_initialize_vapid", params: undefined },
    { name: "saldo_get_or_initialize_vapid", params: { p_public_key: generatedPair.publicKey, p_private_key: generatedPair.privateKey } },
  ]);
});

test("applies the limit using the verified account even when the body supplies another ID", async () => {
  scenario.quota = false;
  const response = await handler(request({ body: '{"kind":"test","user_id":"unrelated"}' }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "300");
  assert.deepEqual(scenario.calls, [{ name: "saldo_claim_push_quota", params: { p_user_id: userId } }]);
  assert.deepEqual(scenario.fetches, []);
});

test("posts requests only to supported Web Push hosts", async () => {
  const approved = [
    "https://fcm.googleapis.com/fcm/send/saldo-test",
    "https://updates.push.services.mozilla.com/wpush/v2/saldo-test",
    "https://web.push.apple.com/saldo-test",
    "https://wns2-par01p.notify.windows.com/saldo-test",
  ];
  const excluded = [
    "https://fcm.googleapis.com.example.invalid/fcm/send/saldo-test",
    "https://other.example.invalid/notice",
  ];
  scenario.rows = [...approved, ...excluded].map(subscription);
  const response = await handler(request({ body: '{"kind":"budget_80"}' }));
  assert.deepEqual(await response.json(), { ok: true, sent: 4, transientFailures: 0, subscriptions: 5 });
  assert.deepEqual(scenario.fetches.map(({ url }) => url), approved);
  assert.deepEqual(scenario.deleted, [excluded[0]]);
  assert.equal(scenario.fetches[0].payload.tag, "saldo-budget_80");
  assert.equal(scenario.fetches[0].payload.url, origin + "/saldo-finanzas/");
});

test("blocks unsafe endpoint shapes and malformed subscription keys with zero outbound calls", async () => {
  const excluded = [
    "http://fcm.googleapis.com/fcm/send/saldo-test",
    "https://fcm.googleapis.com:9001/fcm/send/saldo-test",
    "https://name@fcm.googleapis.com/fcm/send/saldo-test",
    "https://web.push.apple.com.example.invalid/saldo-test",
    "https://fcm.googleapis.com/wrong",
  ];
  scenario.rows = excluded.map(subscription);
  const response = await handler(request());
  assert.deepEqual(await response.json(), { ok: true, sent: 0, transientFailures: 0, subscriptions: 5 });
  assert.deepEqual(scenario.deleted, excluded);
  assert.deepEqual(scenario.fetches, []);

  scenario.rows = [{ ...subscription("https://web.push.apple.com/saldo-test"), p256dh: "missing-key" }];
  await handler(request());
  assert.deepEqual(scenario.fetches, []);
});

test("removes a 410 subscription and preserves it on a transient failure", async () => {
  const endpoint = "https://web.push.apple.com/saldo-test";
  scenario.rows = [subscription(endpoint)];
  scenario.providerStatus = 410;
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(scenario.deleted, [endpoint]);

  scenario.providerStatus = 503;
  scenario.deleted = [];
  assert.equal((await handler(request())).status, 502);
  assert.deepEqual(scenario.deleted, []);
});

test("restricts cron access and dispatches only claimed accounts", async () => {
  assert.equal((await handler(request({ from: null, token: null, cron: "wrong" }))).status, 401);
  assert.equal((await handler(request({ token: null, cron: fakeCronSecret }))).status, 401);
  assert.deepEqual(scenario.calls, []);
  assert.equal((await handler(request({ from: null, token: null, cron: "a".repeat(64) }))).status, 401);
  assert.deepEqual(scenario.calls, [{ name: "saldo_get_cron_token", params: undefined }]);
  scenario.calls = [];
  scenario.reminders = [{ user_id: userId, reminder_month: "2026-11", attempt_count: 1 }];
  scenario.rows = [subscription("https://web.push.apple.com/saldo-test")];
  const response = await handler(request({ from: null, token: null, cron: fakeCronSecret }));
  assert.deepEqual(await response.json(), { ok: true, sent: 1 });
  assert.deepEqual(scenario.calls, [
    { name: "saldo_get_cron_token", params: undefined },
    { name: "saldo_get_or_initialize_vapid", params: undefined },
    { name: "saldo_claim_due_push_reminders", params: { p_limit: 24 } },
    { name: "saldo_claim_due_recurring_reminders", params: { p_limit: 24 } },
  ]);
  assert.deepEqual(scenario.completed[0].filters, {
    user_id: userId, reminder_month: "2026-11", reminder_type: "monthly", attempt_count: 1,
  });
});

test("groups recurring reminders into one generic notification and completes every claimed occurrence", async () => {
  const first = { user_id: userId, recurring_id: "test-rent", occurrence_date: "2026-11-20", attempt_count: 1 };
  const second = { user_id: userId, recurring_id: "test-income", occurrence_date: "2026-11-27", attempt_count: 2 };
  scenario.recurringReminders = [{ ...first, title: "Private rule title", amount: 987654321 }, second];
  scenario.rows = [subscription("https://web.push.apple.com/saldo-test")];

  const response = await handler(request({ from: null, token: null, cron: fakeCronSecret }));
  assert.deepEqual(await response.json(), { ok: true, sent: 1 });
  assert.equal(scenario.fetches.length, 1);
  assert.deepEqual(scenario.fetches[0].payload, {
    title: "Saldo · Próximos movimientos",
    body: "Tienes movimientos programados por revisar. Abre Saldo para verlos.",
    tag: "saldo-recurring",
    url: origin + "/saldo-finanzas/",
  });
  assert.deepEqual(scenario.completed.map(({ table, filters }) => ({ table, filters })), [
    { table: "push_recurring_dispatches", filters: first },
    { table: "push_recurring_dispatches", filters: second },
  ]);
});

test("leaves recurring occurrences available for retry when the provider is temporarily unavailable", async () => {
  scenario.recurringReminders = [{ user_id: userId, recurring_id: "retry", occurrence_date: "2026-11-20", attempt_count: 1 }];
  scenario.rows = [subscription("https://web.push.apple.com/saldo-test")];
  scenario.providerStatus = 503;

  const response = await handler(request({ from: null, token: null, cron: fakeCronSecret }));
  assert.deepEqual(await response.json(), { ok: true, sent: 0 });
  assert.equal(scenario.fetches.length, 1);
  assert.deepEqual(scenario.completed, []);
});

test("continues monthly delivery and reports failure when recurring claims are unavailable", async () => {
  scenario.recurringError = true;
  scenario.reminders = [{ user_id: userId, reminder_month: "2026-11", attempt_count: 1 }];
  scenario.rows = [subscription("https://web.push.apple.com/saldo-test")];

  const response = await handler(request({ from: null, token: null, cron: fakeCronSecret }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Una tarea de recordatorios no respondió.", sent: 1 });
  assert.equal(scenario.fetches[0].payload.tag, "saldo-monthly");
  assert.equal(scenario.completed[0].table, "push_reminder_dispatches");
});
