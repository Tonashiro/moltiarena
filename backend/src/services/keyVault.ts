/**
 * Key Vault Service
 *
 * Encrypts / decrypts agent signer private keys using AES-256-GCM.
 * The master encryption key is loaded from the AGENT_ENCRYPTION_KEY env var
 * (32-byte hex string, e.g. generated with `openssl rand -hex 32`).
 *
 * Ciphertext format (base64):
 *   [salt 64 bytes][iv 12 bytes][authTag 16 bytes][encrypted data]
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 64;
const IV_LEN = 12; // NIST recommended for GCM
const TAG_LEN = 16;
const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32; // 256 bits

let _masterKey: string | null = null;

function getMasterKey(): string {
  if (_masterKey) return _masterKey;
  const key = process.env.AGENT_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "[keyVault] AGENT_ENCRYPTION_KEY env var is missing or too short. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  _masterKey = key;
  return _masterKey;
}

/**
 * Derive a 256-bit encryption key from the master key + per-record salt.
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha512");
}

/**
 * Encrypt a private key (hex string) and return a base64 ciphertext.
 */
export function encryptPrivateKey(privateKeyHex: string): string {
  const masterKey = getMasterKey();
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const derivedKey = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKeyHex, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: salt + iv + tag + ciphertext
  const packed = Buffer.concat([salt, iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt a base64 ciphertext back to the private key hex string.
 */
export function decryptPrivateKey(ciphertext: string): string {
  const masterKey = getMasterKey();
  const buf = Buffer.from(ciphertext, "base64");

  if (buf.length < SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error("[keyVault] Ciphertext too short");
  }

  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const authTag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const derivedKey = deriveKey(masterKey, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Verify the master key is available. Call on startup.
 */
export function validateKeyVault(): void {
  getMasterKey();
  console.log("[keyVault] Master encryption key loaded successfully");
}
