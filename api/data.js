import crypto from "node:crypto";

const CATEGORIES = ["sofas", "tables", "chairs", "beds", "lamps", "shelves", "rugs", "desks"];
const ADJECTIVES = ["Nordic", "Classic", "Urban", "Cozy", "Modern", "Rustic", "Compact", "Grand"];

/** 1,000 deterministic products, so test results are reproducible. */
export function createProducts(count = 1000) {
  return Array.from({ length: count }, (_, i) => {
    const category = CATEGORIES[i % CATEGORIES.length];
    return {
      id: i + 1,
      name: `${ADJECTIVES[i % ADJECTIVES.length]} ${category.slice(0, -1)} ${100 + i}`,
      category,
      price: Math.round((19 + ((i * 37) % 900)) * 100) / 100,
      stock: (i * 13) % 50,
    };
  });
}

export const PBKDF2_ITERATIONS = 10_000;

export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
}

/**
 * Test users user1 … userN, all with the password "Test1234!".
 * user1 is an admin. Load tests use one account per virtual user, so that
 * parallel users don't share (and empty) the same shopping cart.
 */
export function createUsers(count = 1000) {
  const users = new Map();
  for (let i = 1; i <= count; i++) {
    const salt = `salt-${i}`;
    users.set(`user${i}`, { username: `user${i}`, salt, hash: hashPassword("Test1234!", salt), role: i === 1 ? "admin" : "customer" });
  }
  return users;
}
