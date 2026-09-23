import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state-store.mjs";

test("idempotency and seller notification survive restart", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ec10-bridge-"));
  const file = path.join(dir, "state.json");
  const first = new StateStore(file); await first.open();
  await first.rememberResult("message-1", { text: "Resposta única" });
  await first.markSent("message-1", "Resposta única");
  await first.queueNotification("booking-1", { phone: "000", text: "Reunião" });
  const second = new StateStore(file); await second.open();
  assert.equal(second.getResult("message-1").text, "Resposta única");
  assert.equal(second.isSent("message-1"), true);
  assert.equal(second.nextNotification()[0], "booking-1");
  JSON.parse(await readFile(file, "utf8"));
});
