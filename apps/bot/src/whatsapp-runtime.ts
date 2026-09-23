import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";

export type WhatsAppRuntimeStatus =
  | "not_ready"
  | "booting"
  | "disabled"
  | "waiting_qr_scan"
  | "authenticated"
  | "loading"
  | "ready"
  | "state_changed"
  | "reconnecting"
  | "disconnected"
  | "auth_failure";

type RuntimePayload = Record<string, unknown>;

type RuntimeCoordinatorOptions = {
  statusPath: string;
  qrImagePath: string;
  qrTextPath: string;
  heartbeatMs: number;
  resolvePath: (value: string) => string;
  persist: (key: string, payload: RuntimePayload) => Promise<void>;
  systemDetails: () => RuntimePayload;
  onStatus?: (status: WhatsAppRuntimeStatus, details: RuntimePayload) => void;
};

type QrSnapshot = {
  qrHash: string;
  qrGeneratedAt: string;
};

async function ensureParent(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function atomicWrite(filePath: string, content: string | Buffer) {
  await ensureParent(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

/**
 * Single writer for the WhatsApp transport state.
 *
 * Every mutation is serialized so an older async event can never overwrite a
 * newer status. The QR hash is copied to both rows, allowing readers to reject
 * mixed snapshots instead of showing an expired QR code.
 */
export class WhatsAppRuntimeCoordinator {
  private currentStatus: WhatsAppRuntimeStatus = "not_ready";
  private currentDetails: RuntimePayload = {};
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: RuntimeCoordinatorOptions) {}

  get status() {
    return this.currentStatus;
  }

  get details() {
    return { ...this.currentDetails };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async writeStatus(status: WhatsAppRuntimeStatus, details: RuntimePayload) {
    const updatedAt = new Date().toISOString();
    const mergedDetails = { ...this.options.systemDetails(), ...details };
    const payload = { status, updatedAt, ...mergedDetails };
    const statusPath = this.options.resolvePath(this.options.statusPath);

    await atomicWrite(statusPath, JSON.stringify(payload, null, 2));
    await this.options.persist("bot_status", payload);

    this.currentStatus = status;
    this.currentDetails = mergedDetails;
    this.options.onStatus?.(status, mergedDetails);
    return payload;
  }

  publishStatus(status: WhatsAppRuntimeStatus, details: RuntimePayload = {}) {
    return this.enqueue(async () => {
      const leavingQrScreen = this.currentStatus === "waiting_qr_scan" && status !== "waiting_qr_scan";
      if (leavingQrScreen) {
        await this.options.persist("whatsapp_qr", {
          qrDataUrl: null,
          qrHash: null,
          invalidatedAt: new Date().toISOString(),
          reason: status
        });
      }
      return this.writeStatus(status, details);
    });
  }

  publishQr(qr: string): Promise<QrSnapshot> {
    return this.enqueue(async () => {
      const qrGeneratedAt = new Date().toISOString();
      const qrHash = createHash("sha256").update(qr).digest("hex");
      const qrImagePath = this.options.resolvePath(this.options.qrImagePath);
      const qrTextPath = this.options.resolvePath(this.options.qrTextPath);
      const [png, qrDataUrl] = await Promise.all([
        QRCode.toBuffer(qr, { margin: 2, width: 360, type: "png" }),
        QRCode.toDataURL(qr, { margin: 4, width: 1000 })
      ]);

      await Promise.all([
        atomicWrite(qrImagePath, png),
        atomicWrite(qrTextPath, qr)
      ]);
      await this.options.persist("whatsapp_qr", {
        qrDataUrl,
        qrHash,
        updatedAt: qrGeneratedAt
      });
      await this.writeStatus("waiting_qr_scan", {
        qrHash,
        qrGeneratedAt,
        qrPath: qrImagePath
      });
      return { qrHash, qrGeneratedAt };
    });
  }

  startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      void this.publishStatus(this.currentStatus, {
        ...this.currentDetails,
        heartbeat: true
      }).catch((error) => console.error("Failed to write bot heartbeat", error));
    }, Math.max(30_000, this.options.heartbeatMs));
    this.heartbeat.unref?.();
  }

  stopHeartbeat() {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
