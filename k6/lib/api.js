/**
 * Thin client for the Shop API. Every request gets a "name" tag (for
 * per-endpoint metrics) and functional checks – a fast wrong answer is
 * still a failure.
 */
import { check } from "k6";
import http from "k6/http";
import { BASE_URL } from "./config.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Server time spent in the current journey (sum of all request durations, without
 * think time). Each virtual user has its own copy of this module, so this is per user.
 */
export const journeyTimer = { total: 0 };
const track = (res) => {
  journeyTimer.total += res.timings.duration;
  return res;
};

function auth(token) {
  return { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
}

function safeJson(res, selector) {
  try {
    return res.json(selector);
  } catch {
    return undefined;
  }
}

export function login(username, password) {
  const res = track(http.post(`${BASE_URL}/api/login`, JSON.stringify({ username, password }), {
    headers: JSON_HEADERS,
    tags: { name: "login" },
  }));
  const token = safeJson(res, "token");
  check(res, {
    "login: status 200": (r) => r.status === 200,
    "login: returns a token": () => typeof token === "string" && token.length > 20,
  });
  return token;
}

export function listProducts({ q = "", category = "", page = 1, limit = 20 } = {}) {
  const params = [`page=${page}`, `limit=${limit}`];
  if (q) params.push(`q=${encodeURIComponent(q)}`);
  if (category) params.push(`category=${category}`);
  const res = track(http.get(`${BASE_URL}/api/products?${params.join("&")}`, { tags: { name: "products" } }));
  const items = safeJson(res, "items") ?? [];
  check(res, {
    "products: status 200": (r) => r.status === 200,
    "products: returns a list": () => Array.isArray(items),
    "products: at most `limit` items": () => items.length <= limit,
  });
  return items;
}

export function getProduct(id) {
  const res = track(http.get(`${BASE_URL}/api/products/${id}`, { tags: { name: "product" } }));
  check(res, {
    "product: status 200": (r) => r.status === 200,
    "product: correct id": () => safeJson(res, "id") === id,
  });
  return res;
}

export function addToCart(token, productId, quantity = 1) {
  const res = track(http.post(`${BASE_URL}/api/cart/items`, JSON.stringify({ productId, quantity }), {
    headers: auth(token),
    tags: { name: "add_to_cart" },
  }));
  check(res, { "add to cart: status 201": (r) => r.status === 201 });
  return res;
}

export function getCart(token) {
  const res = track(http.get(`${BASE_URL}/api/cart`, { headers: auth(token), tags: { name: "cart" } }));
  check(res, {
    "cart: status 200": (r) => r.status === 200,
    "cart: total is a number": () => typeof safeJson(res, "total") === "number",
  });
  return res;
}

export function checkout(token) {
  const res = track(http.post(`${BASE_URL}/api/orders`, null, { headers: auth(token), tags: { name: "checkout" } }));
  check(res, {
    "checkout: status 201": (r) => r.status === 201,
    "checkout: returns an order id": () => /^ORD-\d+$/.test(safeJson(res, "orderId") ?? ""),
  });
  return res;
}

export function salesReport(token) {
  const res = track(http.get(`${BASE_URL}/api/reports/sales`, { headers: auth(token), tags: { name: "sales_report" } }));
  check(res, { "sales report: status 200": (r) => r.status === 200 });
  return res;
}
