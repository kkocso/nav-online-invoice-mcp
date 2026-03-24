// SHA-512: use Node.js built-in crypto (no external dependency needed)
// SHA3-512: use js-sha3 (Node.js built-in crypto does not support SHA3 in all versions)
// NOTE: js-sha512 is intentionally NOT used — native crypto covers SHA-512
import { createHash, createDecipheriv, randomBytes } from "node:crypto";
import { sha3_512 } from "js-sha3";

export function sha512(input: string): string {
  return createHash("sha512").update(input, "utf8").digest("hex").toUpperCase();
}

export function sha3Hash512(input: string): string {
  return sha3_512(input).toUpperCase();
}

export function computePasswordHash(password: string): string {
  return sha512(password);
}

export function computeRequestSignature(
  requestId: string,
  timestamp: string,
  signatureKey: string,
  invoiceHashes?: string[]
): string {
  // timestamp format for signature: YYYYMMDDHHmmss (strip separators from ISO)
  const ts = timestamp.replace(/[-T:Z.]/g, "").substring(0, 14);

  let signatureInput = requestId + ts + signatureKey;

  if (invoiceHashes && invoiceHashes.length > 0) {
    signatureInput += invoiceHashes.join("");
  }

  return sha3Hash512(signatureInput);
}

export function computeInvoiceHash(
  operation: string,
  base64Data: string
): string {
  return sha3Hash512(operation + base64Data);
}

export function decryptExchangeToken(
  encodedToken: string,
  exchangeKey: string
): string {
  const keyBuffer = Buffer.from(exchangeKey, "utf8").subarray(0, 16);
  const encrypted = Buffer.from(encodedToken, "base64");
  const decipher = createDecipheriv("aes-128-ecb", keyBuffer, null);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function generateRequestId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const prefix = "MCP";
  const timestamp = Date.now().toString(36).toUpperCase();
  let result = prefix + timestamp;
  const bytes = randomBytes(30);
  while (result.length < 30) {
    result += chars.charAt(bytes[result.length] % chars.length);
  }
  return result.substring(0, 30);
}
