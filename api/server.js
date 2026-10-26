/**
 * "Nordlicht Shop API" – the system under test.
 *
 * A small online-shop API with the performance characteristics of a real one:
 *  - a database connection pool (limited parallelism → queueing under load)
 *  - CPU-heavy password hashing on login
 *  - a slow external payment provider on checkout
 *  - an expensive back-office report that blocks the event loop
 *
 * Set PERF_BUG=n_plus_one to introduce a classic performance regression
 * (one extra database query per product in the product list).
 */
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProducts, createUsers, PBKDF2_ITERATIONS } from "./data.js";
import { ConnectionPool, sleep } from "./pool.js";

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) reject(Object.assign(new Error("Body too large"), { status: 413 }));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

export function createApp({
  perfBug = process.env.PERF_BUG ?? "",
  poolSize = Number(process.env.DB_POOL_SIZE ?? 10),
  paymentLatencyMs = [80, 180],
  userCount = Number(process.env.USER_COUNT ?? 1000),
} = {}) {
  const products = createProducts();
  const productsById = new Map(products.map((p) => [p.id, p]));
  const users = createUsers(userCount);
  const sessions = new Map(); // token -> username
  const carts = new Map(); // username -> [{productId, quantity}]
  const pool = new ConnectionPool({ size: poolSize });
  const metrics = { inFlight: 0, requests: new Map(), durations: new Map(), orders: 0 };

  function authenticate(req) {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const username = sessions.get(token);
    if (!username) throw httpError(401, "Missing or invalid token");
    return users.get(username);
  }

  // ---------- route handlers ----------

  async function login(req, res) {
    const { username, password } = await readJson(req);
    const user = users.get(String(username ?? ""));
    // Hashing is deliberately CPU-expensive (like bcrypt in production) – runs in Node's thread pool
    const hash = await new Promise((resolve, reject) =>
      crypto.pbkdf2(String(password ?? ""), user?.salt ?? "no-user", PBKDF2_ITERATIONS, 32, "sha256", (err, key) =>
        err ? reject(err) : resolve(key.toString("hex")),
      ),
    );
    if (!user || hash !== user.hash) throw httpError(401, "Invalid username or password");
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, user.username);
    sendJson(res, 200, { token });
  }

  async function listProducts(req, res, url) {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const category = url.searchParams.get("category");
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

    const matching = await pool.query(8, 18, () =>
      products.filter((p) => (!category || p.category === category) && (!q || p.name.toLowerCase().includes(q))),
    );
    let items = matching.slice((page - 1) * limit, page * limit);

    if (perfBug === "n_plus_one") {
      // BUG: loads the stock of every product with its own query instead of one joined query
      items = [];
      for (const p of matching.slice((page - 1) * limit, page * limit)) {
        items.push(await pool.query(2, 5, () => ({ ...p, stock: productsById.get(p.id).stock })));
      }
    }
    sendJson(res, 200, { items, total: matching.length, page, limit });
  }

  async function getProduct(req, res, id) {
    const product = await pool.query(3, 8, () => productsById.get(id));
    if (!product) throw httpError(404, "Product not found");
    sendJson(res, 200, product);
  }

  async function addToCart(req, res) {
    const user = authenticate(req);
    const { productId, quantity = 1 } = await readJson(req);
    const product = productsById.get(Number(productId));
    if (!product) throw httpError(404, "Product not found");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw httpError(400, "quantity must be 1–10");
    await pool.query(4, 10);
    const cart = carts.get(user.username) ?? [];
    cart.push({ productId: product.id, quantity, price: product.price });
    carts.set(user.username, cart);
    sendJson(res, 201, { items: cart.length });
  }

  async function getCart(req, res) {
    const user = authenticate(req);
    const cart = await pool.query(3, 8, () => carts.get(user.username) ?? []);
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    sendJson(res, 200, { items: cart, total: Math.round(total * 100) / 100 });
  }

  async function createOrder(req, res) {
    const user = authenticate(req);
    const cart = carts.get(user.username) ?? [];
    if (cart.length === 0) throw httpError(400, "Cart is empty");
    await pool.query(10, 20); // reserve stock
    // External payment provider: slow, but does not hold a database connection
    await sleep(paymentLatencyMs[0] + Math.random() * (paymentLatencyMs[1] - paymentLatencyMs[0]));
    await pool.query(8, 15); // write order
    carts.delete(user.username);
    metrics.orders++;
    sendJson(res, 201, { orderId: `ORD-${metrics.orders}`, total: cart.reduce((s, i) => s + i.price * i.quantity, 0) });
  }

  function salesReport(req, res) {
    const user = authenticate(req);
    if (user.role !== "admin") throw httpError(403, "Admins only");
    // Synchronous heavy computation: blocks the event loop and slows down ALL other requests
    let checksum = 0;
    for (let i = 0; i < 3_000_000; i++) checksum = (checksum + Math.sqrt(i) * (i % 7)) % 1_000_007;
    sendJson(res, 200, { orders: metrics.orders, checksum });
  }

  function prometheusMetrics(res) {
    const lines = [
      "# HELP shop_http_requests_total HTTP requests by route and status",
      "# TYPE shop_http_requests_total counter",
      ...[...metrics.requests].map(([key, n]) => `shop_http_requests_total{${key}} ${n}`),
      "# HELP shop_http_request_duration_seconds_sum Total time spent per route",
      "# TYPE shop_http_request_duration_seconds_sum counter",
      ...[...metrics.durations].map(([route, s]) => `shop_http_request_duration_seconds_sum{route="${route}"} ${s.toFixed(3)}`),
      "# TYPE shop_http_in_flight_requests gauge",
      `shop_http_in_flight_requests ${metrics.inFlight}`,
      "# TYPE shop_db_pool_active_connections gauge",
      `shop_db_pool_active_connections ${pool.active}`,
      "# TYPE shop_db_pool_queue_length gauge",
      `shop_db_pool_queue_length ${pool.queue.length}`,
      "# TYPE shop_db_pool_timeouts_total counter",
      `shop_db_pool_timeouts_total ${pool.stats.timeouts}`,
      "# TYPE shop_orders_total counter",
      `shop_orders_total ${metrics.orders}`,
      "# TYPE process_heap_used_bytes gauge",
      `process_heap_used_bytes ${process.memoryUsage().heapUsed}`,
    ];
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(`${lines.join("\n")}\n`);
  }

  // ---------- router ----------

  async function route(req, res, url) {
    const { pathname } = url;
    const m = req.method;
    if (m === "GET" && pathname === "/health") return ["health", () => sendJson(res, 200, { ok: true, perfBug: perfBug || null })];
    if (m === "GET" && pathname === "/metrics") return ["metrics", () => prometheusMetrics(res)];
    if (m === "POST" && pathname === "/api/login") return ["login", () => login(req, res)];
    if (m === "GET" && pathname === "/api/products") return ["products", () => listProducts(req, res, url)];
    const productMatch = /^\/api\/products\/(\d+)$/.exec(pathname);
    if (m === "GET" && productMatch) return ["product", () => getProduct(req, res, Number(productMatch[1]))];
    if (m === "GET" && pathname === "/api/cart") return ["cart", () => getCart(req, res)];
    if (m === "POST" && pathname === "/api/cart/items") return ["add_to_cart", () => addToCart(req, res)];
    if (m === "POST" && pathname === "/api/orders") return ["checkout", () => createOrder(req, res)];
    if (m === "GET" && pathname === "/api/reports/sales") return ["sales_report", () => salesReport(req, res)];
    return ["not_found", () => sendJson(res, 404, { error: "Not found" })];
  }

  const server = http.createServer(async (req, res) => {
    const started = performance.now();
    const url = new URL(req.url, "http://localhost");
    metrics.inFlight++;
    const [name, handler] = await route(req, res, url);
    try {
      await handler();
    } catch (error) {
      const status = error.status ?? 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { error: error.message });
    } finally {
      metrics.inFlight--;
      const key = `route="${name}",status="${res.statusCode}"`;
      metrics.requests.set(key, (metrics.requests.get(key) ?? 0) + 1);
      metrics.durations.set(name, (metrics.durations.get(name) ?? 0) + (performance.now() - started) / 1000);
    }
  });
  server.keepAliveTimeout = 65_000;
  server.pool = pool;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createApp();
  server.listen(port, () => {
    console.log(`Shop API running on http://localhost:${port}`);
    if (process.env.PERF_BUG) console.log(`⚠️  Performance bug enabled: ${process.env.PERF_BUG}`);
  });
}
