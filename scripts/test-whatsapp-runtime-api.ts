import assert from "node:assert/strict";
import { decodeCurrentQr, type RuntimeRow } from "../api/_whatsapp-runtime.js";

const now = new Date().toISOString();
const image = Buffer.from("minimal-png");
const qr: RuntimeRow = {
  key: "whatsapp_qr",
  updated_at: now,
  payload: {
    updatedAt: now,
    qrHash: "same-generation",
    qrDataUrl: `data:image/png;base64,${image.toString("base64")}`
  }
};
const waiting: RuntimeRow = {
  key: "bot_status",
  updated_at: now,
  payload: {
    updatedAt: now,
    status: "waiting_qr_scan",
    qrHash: "same-generation"
  }
};

assert.deepEqual(decodeCurrentQr(waiting, qr, 300_000, 180_000), image);
assert.equal(
  decodeCurrentQr({ ...waiting, payload: { ...waiting.payload, qrHash: "old-generation" } }, qr, 300_000, 180_000),
  null,
  "mixed QR generations must be rejected"
);
assert.equal(
  decodeCurrentQr({ ...waiting, payload: { ...waiting.payload, status: "ready" } }, qr, 300_000, 180_000),
  null,
  "connected sessions must never expose QR"
);
assert.equal(
  decodeCurrentQr(waiting, { ...qr, updated_at: "2020-01-01T00:00:00.000Z", payload: { ...qr.payload, updatedAt: null } }, 300_000, 180_000),
  null,
  "expired QR must be rejected"
);

console.log("WhatsApp runtime API: snapshot consistency test passed.");
