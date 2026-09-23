import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WhatsAppRuntimeCoordinator } from "../apps/bot/dist/whatsapp-runtime.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ec10-whatsapp-runtime-"));
const persisted = new Map();
const persistenceHistory = [];

try {
  const runtime = new WhatsAppRuntimeCoordinator({
    statusPath: "status.json",
    qrImagePath: "qr.png",
    qrTextPath: "qr.txt",
    heartbeatMs: 60_000,
    resolvePath: (value) => path.join(testRoot, value),
    persist: async (key, payload) => {
      await new Promise((resolve) => setTimeout(resolve, key === "whatsapp_qr" ? 5 : 1));
      persisted.set(key, structuredClone(payload));
      persistenceHistory.push({ key, payload: structuredClone(payload) });
    },
    systemDetails: () => ({ botInstanceId: "main", databaseSchema: "whatsapp_bot" })
  });

  await runtime.publishStatus("booting");
  await runtime.publishQr("minimal-qr-generation-1");

  const qr1 = persisted.get("whatsapp_qr");
  const waiting1 = persisted.get("bot_status");
  assert.equal(waiting1.status, "waiting_qr_scan");
  assert.equal(waiting1.qrHash, qr1.qrHash, "status and QR must describe the same generation");
  assert.ok(String(qr1.qrDataUrl).startsWith("data:image/png;base64,"));

  await runtime.publishQr("minimal-qr-generation-2");
  const qr2 = persisted.get("whatsapp_qr");
  const waiting2 = persisted.get("bot_status");
  assert.notEqual(qr2.qrHash, qr1.qrHash, "a refreshed QR must replace the old generation");
  assert.equal(waiting2.qrHash, qr2.qrHash);

  await Promise.all([
    runtime.publishStatus("authenticated"),
    runtime.publishStatus("loading", { percent: "50" }),
    runtime.publishStatus("ready", { state: "CONNECTED" })
  ]);

  const finalStatus = persisted.get("bot_status");
  const invalidatedQr = persisted.get("whatsapp_qr");
  assert.equal(finalStatus.status, "ready", "the latest queued transport event must win");
  assert.equal(finalStatus.state, "CONNECTED");
  assert.equal(invalidatedQr.qrDataUrl, null, "a connected session must never expose an old QR");

  const localStatus = JSON.parse(await fs.readFile(path.join(testRoot, "status.json"), "utf8"));
  assert.equal(localStatus.status, "ready");
  assert.equal(localStatus.botInstanceId, "main");
  assert.ok(persistenceHistory.length >= 8);

  console.log("WhatsApp runtime refactor: minimal fault test passed.");
} finally {
  await fs.rm(testRoot, { recursive: true, force: true });
}
