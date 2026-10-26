/**
 * Simulates a database connection pool – the most common bottleneck in real
 * web applications. Only `size` queries run at the same time; everything else
 * waits in a queue. Under load the queue grows and response times rise sharply
 * (the "knee" in a stress test). Waiting longer than `queueTimeoutMs` fails.
 */
export class ConnectionPool {
  constructor({ size = 10, queueTimeoutMs = 3000 } = {}) {
    this.size = size;
    this.queueTimeoutMs = queueTimeoutMs;
    this.active = 0;
    this.queue = [];
    this.stats = { queries: 0, timeouts: 0, maxQueue: 0 };
  }

  acquire() {
    if (this.active < this.size) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiter.timer = setTimeout(() => {
        this.queue.splice(this.queue.indexOf(waiter), 1);
        this.stats.timeouts++;
        reject(Object.assign(new Error("Database pool exhausted"), { status: 503 }));
      }, this.queueTimeoutMs);
      this.queue.push(waiter);
      this.stats.maxQueue = Math.max(this.stats.maxQueue, this.queue.length);
    });
  }

  release() {
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(); // hand the connection directly to the next waiter
    } else {
      this.active--;
    }
  }

  /** Runs a simulated query that takes between minMs and maxMs. */
  async query(minMs, maxMs, fn = () => undefined) {
    await this.acquire();
    try {
      this.stats.queries++;
      await sleep(minMs + Math.random() * (maxMs - minMs));
      return fn();
    } finally {
      this.release();
    }
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
