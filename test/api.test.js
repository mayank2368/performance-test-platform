/**
 * Functional tests for the system under test – a performance test is only
 * meaningful if the API itself works correctly.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ConnectionPool } from "../api/pool.js";
import { createApp } from "../api/server.js";

async function start(options = {}) {
  const server = createApp({ userCount: 5, paymentLatencyMs: [1, 2], ...options });
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Shop API", () => {
  let server;
  let base;
  before(async () => ({ server, base } = await start()));
  after(() => server.close());

  async function loginAs(username = "user2") {
    const res = await fetch(`${base}/api/login`, json({ username, password: "Test1234!" }));
    return (await res.json()).token;
  }

  it("logs in with valid credentials and rejects wrong ones", async () => {
    assert.match(await loginAs(), /^[0-9a-f]{48}$/);
    const wrong = await fetch(`${base}/api/login`, json({ username: "user2", password: "nope" }));
    assert.equal(wrong.status, 401);
  });

  it("lists, filters and paginates products", async () => {
    const all = await (await fetch(`${base}/api/products?limit=5`)).json();
    assert.equal(all.items.length, 5);
    assert.equal(all.total, 1000);
    const sofas = await (await fetch(`${base}/api/products?category=sofas&limit=50`)).json();
    assert.ok(sofas.items.every((p) => p.category === "sofas"));
    const page2 = await (await fetch(`${base}/api/products?limit=5&page=2`)).json();
    assert.notEqual(page2.items[0].id, all.items[0].id);
  });

  it("returns a product or 404", async () => {
    assert.equal((await (await fetch(`${base}/api/products/42`)).json()).id, 42);
    assert.equal((await fetch(`${base}/api/products/99999`)).status, 404);
  });

  it("runs the whole purchase flow: cart → order", async () => {
    const token = await loginAs("user3");
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/api/cart/items`, { method: "POST", headers, body: JSON.stringify({ productId: 7, quantity: 2 }) })).status, 201);
    const cart = await (await fetch(`${base}/api/cart`, { headers })).json();
    assert.equal(cart.items.length, 1);
    const order = await fetch(`${base}/api/orders`, { method: "POST", headers });
    assert.equal(order.status, 201);
    assert.match((await order.json()).orderId, /^ORD-\d+$/);
    assert.equal((await fetch(`${base}/api/orders`, { method: "POST", headers })).status, 400, "cart is empty after ordering");
  });

  it("requires authentication for cart and orders", async () => {
    assert.equal((await fetch(`${base}/api/cart`)).status, 401);
    assert.equal((await fetch(`${base}/api/orders`, { method: "POST" })).status, 401);
  });

  it("restricts the sales report to admins", async () => {
    const customer = await loginAs("user2");
    assert.equal((await fetch(`${base}/api/reports/sales`, { headers: { authorization: `Bearer ${customer}` } })).status, 403);
    const admin = await loginAs("user1");
    assert.equal((await fetch(`${base}/api/reports/sales`, { headers: { authorization: `Bearer ${admin}` } })).status, 200);
  });

  it("validates input", async () => {
    const token = await loginAs();
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const res = await fetch(`${base}/api/cart/items`, { method: "POST", headers, body: JSON.stringify({ productId: 1, quantity: 99 }) });
    assert.equal(res.status, 400);
    assert.equal((await fetch(`${base}/api/login`, { method: "POST", body: "{broken" })).status, 400);
  });

  it("exposes Prometheus metrics", async () => {
    const text = await (await fetch(`${base}/metrics`)).text();
    assert.match(text, /shop_http_requests_total\{route="products",status="200"\} \d+/);
    assert.match(text, /shop_db_pool_queue_length \d+/);
  });
});

describe("performance bug switch (N+1 queries)", () => {
  it("makes the product list measurably slower with the same result", async () => {
    const normal = await start();
    const buggy = await start({ perfBug: "n_plus_one" });
    const time = async (base) => {
      const t = performance.now();
      const body = await (await fetch(`${base}/api/products?limit=20`)).json();
      return { ms: performance.now() - t, ids: body.items.map((p) => p.id) };
    };
    const a = await time(normal.base);
    const b = await time(buggy.base);
    normal.server.close();
    buggy.server.close();
    assert.deepEqual(b.ids, a.ids, "functionally identical – only performance differs");
    assert.ok(b.ms > a.ms + 30, `expected the N+1 version to be slower (${a.ms.toFixed(0)} ms vs ${b.ms.toFixed(0)} ms)`);
  });
});

describe("connection pool", () => {
  it("never runs more queries in parallel than its size", async () => {
    const pool = new ConnectionPool({ size: 3 });
    const queries = Array.from({ length: 10 }, () => pool.query(5, 10));
    // Right after starting 10 queries: 3 are running, 7 are waiting
    assert.equal(pool.active, 3);
    assert.equal(pool.queue.length, 7);
    let maxActive = 0;
    const sampler = setInterval(() => (maxActive = Math.max(maxActive, pool.active)), 1);
    await Promise.all(queries);
    clearInterval(sampler);
    assert.ok(maxActive <= 3, `at most 3 parallel queries, saw ${maxActive}`);
    assert.equal(pool.active, 0);
    assert.equal(pool.stats.queries, 10);
  });

  it("fails with 503 when the wait in the queue is too long", async () => {
    const pool = new ConnectionPool({ size: 1, queueTimeoutMs: 20 });
    const slow = pool.query(100, 100);
    await assert.rejects(pool.query(1, 1), (error) => error.status === 503);
    await slow;
    assert.equal(pool.stats.timeouts, 1);
  });
});
