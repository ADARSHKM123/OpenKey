import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM envelope for provider credentials at rest.
// Layout: [12-byte IV][16-byte auth tag][ciphertext]. A fresh IV per
// encryption is mandatory for GCM — reuse breaks the whole construction.
//
// Implemented behind this tiny surface so a SecretProvider backed by AWS
// Secrets Manager / Vault can replace it without touching call sites.

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptJson(value: unknown, masterKeyHex: string): Buffer {
  const key = Buffer.from(masterKeyHex, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptJson<T = unknown>(blob: Uint8Array, masterKeyHex: string): T {
  const buf = Buffer.from(blob);
  const key = Buffer.from(masterKeyHex, "hex");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
