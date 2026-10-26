/**
 * User journeys: realistic sequences of requests with "think time" between
 * them, modelled on how real customers use a shop.
 */
import { group, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";
import * as api from "./api.js";
import { THINK_TIME_SCALE } from "./config.js";

// Test data is loaded once and shared between all virtual users (saves memory)
const users = new SharedArray("users", () => JSON.parse(open("../data/users.json")));
const searchTerms = new SharedArray("search terms", () => JSON.parse(open("../data/search-terms.json")));
const CATEGORIES = ["sofas", "tables", "chairs", "beds", "lamps", "shelves", "rugs", "desks"];

/** Server time of a complete purchase (login → checkout), think time excluded. */
export const purchaseDuration = new Trend("purchase_journey_duration", true);
export const ordersCreated = new Counter("orders_created");

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

let thinkScale = THINK_TIME_SCALE;

/** Lets a test use more aggressive users (e.g. 0.1 = 10 % of the normal pause). */
export function setThinkTimeScale(scale) {
  if (__ENV.THINK_TIME_SCALE === undefined) thinkScale = scale; // an explicit -e value always wins
}

/** Random pause between min and max seconds – real users read before they click. */
export function think(min = 1, max = 3) {
  if (thinkScale > 0) sleep((min + Math.random() * (max - min)) * thinkScale);
}

/** Visitor: browses a category and looks at one or two products. */
export function browse() {
  group("browse", () => {
    const items = api.listProducts({ category: pick(CATEGORIES), page: randomInt(1, 3) });
    think(1, 3);
    for (const item of items.slice(0, randomInt(1, 2))) {
      api.getProduct(item.id);
      think(1, 2);
    }
  });
}

/** Visitor: searches for a product. */
export function search() {
  group("search", () => {
    const items = api.listProducts({ q: pick(searchTerms) });
    think(1, 2);
    if (items.length > 0) api.getProduct(pick(items).id);
    think(0.5, 1.5);
  });
}

/** Customer: logs in, puts products into the cart and orders. */
export function purchase() {
  group("purchase", () => {
    api.journeyTimer.total = 0;
    // One account per virtual user: parallel users never share a cart
    const user = users[(__VU - 1) % users.length];
    const token = api.login(user.username, user.password);
    if (!token) return;
    think(0.5, 1);

    const items = api.listProducts({ category: pick(CATEGORIES) });
    think(1, 2);
    const chosen = items.slice(0, randomInt(1, 2));
    for (const item of chosen) {
      api.getProduct(item.id);
      api.addToCart(token, item.id, randomInt(1, 2));
      think(0.5, 1.5);
    }
    api.getCart(token);
    think(0.5, 1);
    const res = api.checkout(token);
    if (res.status === 201) ordersCreated.add(1);
    purchaseDuration.add(api.journeyTimer.total);
  });
}

let adminToken = null;

/** Back-office employee: opens the (expensive) sales report. */
export function backoffice() {
  group("backoffice", () => {
    adminToken = adminToken ?? api.login("user1", "Test1234!");
    if (adminToken) api.salesReport(adminToken);
  });
}

/** A mix of all customer journeys – used by smoke, stress, spike and soak tests. */
export function mixedTraffic() {
  const r = Math.random();
  if (r < 0.55) browse();
  else if (r < 0.85) search();
  else purchase();
}
