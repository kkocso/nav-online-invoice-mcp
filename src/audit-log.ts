/**
 * Structured audit logger for NAV write operations.
 *
 * Why this exists:
 *   Financial operations (invoice submission, annulment) need a tamper-evident
 *   audit trail for compliance, debugging, and incident investigation. This logger
 *   writes structured JSON to stderr — separate from the MCP stdio transport on
 *   stdout — so the host process can capture and forward it independently.
 *
 * Security constraints:
 *   - NEVER log invoice content, invoice XML, or any customer/supplier data (PII)
 *   - NEVER log credentials, tokens, or keys
 *   - Log only: operation type, index count, timestamp, transaction ID, outcome
 *
 * Output format: one JSON object per line (NDJSON), written to stderr.
 */

export type AuditEventType =
  | "manage_invoice.attempt"
  | "manage_invoice.success"
  | "manage_invoice.error"
  | "manage_invoice.rate_limited"
  | "manage_annulment.attempt"
  | "manage_annulment.success"
  | "manage_annulment.error"
  | "manage_annulment.rate_limited";

export interface AuditEvent {
  timestamp: string;       // ISO 8601 UTC
  event: AuditEventType;
  operationCount: number;  // how many invoice operations in the batch
  transactionId?: string;  // NAV transaction ID (only present on success)
  funcCode?: string;       // NAV result code (OK / ERROR / etc.)
  errorCode?: string;      // NAV error code if present
  rateLimitCount?: number; // current window call count (for rate limit events)
}

export function writeAuditLog(event: AuditEvent): void {
  // Write to stderr — stdout is reserved for MCP protocol messages
  process.stderr.write(JSON.stringify(event) + "\n");
}

export function auditAttempt(
  operation: "manage_invoice" | "manage_annulment",
  operationCount: number
): void {
  writeAuditLog({
    timestamp: new Date().toISOString(),
    event: `${operation}.attempt`,
    operationCount,
  });
}

export function auditSuccess(
  operation: "manage_invoice" | "manage_annulment",
  operationCount: number,
  transactionId?: string,
  funcCode?: string
): void {
  writeAuditLog({
    timestamp: new Date().toISOString(),
    event: `${operation}.success`,
    operationCount,
    transactionId,
    funcCode,
  });
}

export function auditError(
  operation: "manage_invoice" | "manage_annulment",
  operationCount: number,
  funcCode?: string,
  errorCode?: string
): void {
  writeAuditLog({
    timestamp: new Date().toISOString(),
    event: `${operation}.error`,
    operationCount,
    funcCode,
    errorCode,
  });
}

export function auditRateLimited(
  operation: "manage_invoice" | "manage_annulment",
  operationCount: number,
  rateLimitCount: number
): void {
  writeAuditLog({
    timestamp: new Date().toISOString(),
    event: `${operation}.rate_limited`,
    operationCount,
    rateLimitCount,
  });
}
