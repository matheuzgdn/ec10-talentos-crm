import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class StateStore {
  constructor(file) {
    this.file = file;
    this.data = { processed: {}, sent: {}, notifications: {}, paused: {}, stats: { received: 0, sent: 0, duplicates: 0, errors: 0 } };
    this.queue = Promise.resolve();
  }

  async open() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.data = { ...this.data, ...JSON.parse(await readFile(this.file, "utf8")) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save();
    }
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    this.queue = this.queue.then(async () => {
      await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await rename(tmp, this.file);
    });
    return this.queue;
  }

  getResult(messageId) { return this.data.processed[messageId] || null; }
  isSent(messageId) { return Boolean(this.data.sent[messageId]); }
  isPaused(contactKey) { return Number(this.data.paused[contactKey] || 0) > Date.now(); }

  async rememberResult(messageId, result) {
    this.data.processed[messageId] = result;
    this.data.stats.received += 1;
    this.prune();
    await this.save();
  }

  async markSent(messageId, text) {
    this.data.sent[messageId] = { at: new Date().toISOString(), text };
    this.data.stats.sent += 1;
    await this.save();
  }

  async markDuplicate() { this.data.stats.duplicates += 1; await this.save(); }
  async markError() { this.data.stats.errors += 1; await this.save(); }
  async pause(contactKey, minutes = 30) { this.data.paused[contactKey] = Date.now() + minutes * 60_000; await this.save(); }
  async queueNotification(key, notification) { this.data.notifications[key] = { ...notification, status: "queued" }; await this.save(); }
  nextNotification() { return Object.entries(this.data.notifications).find(([, item]) => item.status === "queued") || null; }
  async finishNotification(key, ok, error = null) { if (this.data.notifications[key]) this.data.notifications[key] = { ...this.data.notifications[key], status: ok ? "sent" : "queued", error, attempts: Number(this.data.notifications[key].attempts || 0) + 1 }; await this.save(); }

  prune() {
    for (const key of ["processed", "sent"]) {
      const entries = Object.entries(this.data[key]);
      if (entries.length > 2500) this.data[key] = Object.fromEntries(entries.slice(-1800));
    }
  }
}
