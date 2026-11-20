import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { beforeEach, test } from "node:test";

const origin = "https://santiagominacampo0-bit.github.io";
const session = "header.payload.signature";
const userId = "10000000-0000-0000-0000-000000000001";
const fakeCronSecret = "f".repeat(48);
const env = {
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "fake-server-key",
  VAPID_SUBJECT: origin,
  VAPID_PUBLIC_KEY: "fake-public-key",
  VAPID_PRIVATE_KEY: "fake-private-key",
  SALDO_CRON_SECRET: fakeCronSecret,
};

let handler;
let scenario;
globalThis.Deno = { env: { get: (name) => scenario.env[name] }, serve: (fn) => { handler = fn; } };
globalThis.testPushLibrary = {
  generateRequestDetails: (_subscription, payload) => ({
    body: new TextEncoder().encode(payload),
    headers: { "content-type": "application/octet-stream" },
  }),
  setVapidDetails: () => {},
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
    if (name === "saldo_claim_push_quota") return { data: scenario.quota };
    if (name === "saldo_claim_due_push_reminders") return { data: scenario.reminders };
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
        assert.equal(table, "push_reminder_dispatches");
        scenario.completed.push({ values, filters });
        return this;
      },
    };
  },
};

const packageMocks = new Map([
  ["npm:@supabase/supabase-js@2.119.2", "export const createClient = () => globalThis.testSupabase;"],
  ["npm:web-push@4.0.0", "export const { generateRequestDetails, setVapidDetails } = globalThis.testPushLibrary;"],
]);
const entry = new URL("./index.ts", import.meta.url).href;
const require = createRequire(import.meta.url);

registerHooks({
  load(url, context, loadNext) {
    if (url !== entry) return loadNext(url, context);
    const source = readFileSync(new URL(url), "utf8");
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
await import("./index.ts");

beforeEach(() => {
  scenario = {
    env: { ...env },
    user: { id: userId, role: "authenticated" },
    rows: [],
    quota: true,
    reminders: [],
    completed: [],
    providerStatus: 201,
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
    request({ body: '{"kind":"test","data":"' + "a".repeat(600) + '"}' }),
    request({ body: '{"kind":"test"}', type: "text/plain" }),
  ];
  for (const input of requests) assert.equal((await handler(input)).status, 400);
  assert.deepEqual(scenario.calls, []);
});

test("returns unavailable with missing VAPID secrets before requesting quota", async () => {
  scenario.env.VAPID_PRIVATE_KEY = undefined;
  assert.equal((await handler(request())).status, 503);
  assert.deepEqual(scenario.calls, []);
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
  scenario.reminders = [{ user_id: userId, reminder_month: "2026-11", attempt_count: 1 }];
  scenario.rows = [subscription("https://web.push.apple.com/saldo-test")];
  const response = await handler(request({ from: null, token: null, cron: fakeCronSecret }));
  assert.deepEqual(await response.json(), { ok: true, sent: 1 });
  assert.deepEqual(scenario.calls, [{ name: "saldo_claim_due_push_reminders", params: { p_limit: 24 } }]);
  assert.deepEqual(scenario.completed[0].filters, {
    user_id: userId, reminder_month: "2026-11", reminder_type: "monthly", attempt_count: 1,
  });
});
