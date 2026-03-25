/**
 * LLM04 Data and Model Poisoning — response sanitizer
 *
 * NAV API responses are serialized to JSON and injected directly into the LLM
 * context window as tool output. While the NAV Online Invoice API is a trusted
 * Hungarian government service, defense-in-depth requires sanitizing all
 * external API responses before they reach the model context.
 *
 * Attack scenario: if the NAV API were ever compromised (supply-chain, MitM,
 * DNS hijack), or if invoice data submitted by a 3rd party contained crafted
 * strings, those strings could attempt to override the model's behavior via
 * prompt injection embedded in data fields.
 *
 * Mitigations applied:
 *   1. Control-character stripping   — null bytes and non-printable chars
 *   2. Prompt injection detection    — common injection phrases flagged + replaced
 *   3. Per-field length cap          — prevents context flooding from large fields
 *   4. Total response size cap       — prevents context window exhaustion
 *
 * References:
 *   - OWASP LLM Top 10 (2025) — LLM04 Data and Model Poisoning
 *   - OWASP LLM Top 10 (2025) — LLM01 Prompt Injection (secondary vector)
 *   - CWE-20: Improper Input Validation
 */

/** Maximum characters allowed in a single string field. */
const MAX_FIELD_LENGTH = 2_000;

/**
 * Maximum total JSON character count of the sanitized response.
 * Prevents context window exhaustion from very large invoice payloads.
 */
const MAX_TOTAL_CHARS = 50_000;

/**
 * Patterns that indicate potential prompt injection in data fields.
 * These strings should never appear in legitimate NAV API responses
 * (invoice data, taxpayer records, transaction statuses).
 *
 * Each pattern is tested case-insensitively. On a match, the matched
 * portion is replaced with [FLAGGED_CONTENT] and a warning is emitted.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Classic prompt override attempts
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?|context|rules?)/i,
  /disregard\s+(all|previous|the above)\s+(instructions?|rules?)/i,
  /forget\s+(everything|all|previous|the above)/i,

  // Role reassignment
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(a|an)\s+/i,
  /pretend\s+(to be|you are)/i,
  /roleplay\s+as\s+/i,
  /your\s+new\s+(role|instructions?|purpose|task)\s+(is|are)\s*/i,

  // Structural injection markers used by various LLM frameworks
  /<\s*(instructions?|system|sys|prompt|jailbreak|override)\s*>/i,
  /\[INST\]|\[\/INST\]/,
  /<<SYS>>|<\/SYS>/,
  /<\|system\|>|<\|user\|>|<\|assistant\|>/,

  // Direct instruction injection
  /new\s+instructions?:/i,
  /updated?\s+instructions?:/i,
  /system\s+prompt:/i,
  /override\s+(safety|instructions?|rules?|guidelines?)/i,
  /bypass\s+(safety|filter|restriction|content\s+policy)/i,

  // Data exfiltration patterns
  /repeat\s+(everything|all)\s+(above|before|prior)/i,
  /print\s+(your|the)\s+(?:system\s)?prompt/i,
  /reveal\s+(your|the)\s+(?:system\s)?prompt/i,
];

export interface SanitizeResult {
  /** The sanitized data, safe to serialize into LLM context. */
  data: unknown;
  /**
   * Human-readable warnings for any sanitization actions taken.
   * Empty array = clean response. Non-empty = anomaly detected.
   */
  warnings: string[];
}

/**
 * Sanitize an API response object before it is serialized into the LLM
 * context window as tool output.
 *
 * Safe to call on any value type (object, array, string, number, null).
 * Does not mutate the original; returns a new sanitized copy.
 */
export function sanitizeApiResponse(data: unknown): SanitizeResult {
  const warnings: string[] = [];
  const sanitized = sanitizeValue(data, "", warnings);

  // Total size cap — check after deep sanitization
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > MAX_TOTAL_CHARS) {
    warnings.push(
      `[LLM04] Response size (${serialized.length} chars) exceeded limit of ${MAX_TOTAL_CHARS}. ` +
        `Data truncated to prevent context exhaustion.`
    );
    // Return only the top-level keys with a truncation notice.
    // Deep data is dropped rather than delivered unsanitized.
    const truncated: Record<string, unknown> = {
      _sanitizer_warning: `Original response exceeded ${MAX_TOTAL_CHARS} chars and was truncated`,
    };
    if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
      for (const [k, v] of Object.entries(sanitized as Record<string, unknown>)) {
        const fieldJson = JSON.stringify(v);
        if (fieldJson && fieldJson.length <= 1_000) {
          // eslint-disable-next-line security/detect-object-injection -- k comes from Object.entries(), not user input
          truncated[k] = v;
        } else {
          // eslint-disable-next-line security/detect-object-injection -- k comes from Object.entries(), not user input
          truncated[k] = "[truncated — field too large]";
        }
      }
    }
    return { data: truncated, warnings };
  }

  return { data: sanitized, warnings };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sanitizeValue(value: unknown, path: string, warnings: string[]): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return sanitizeString(value, path, warnings);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => sanitizeValue(item, `${path}[${i}]`, warnings));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${k}` : k;
      // eslint-disable-next-line security/detect-object-injection -- k comes from Object.entries(), not user input
      result[k] = sanitizeValue(v, childPath, warnings);
    }
    return result;
  }

  // Primitive fallback (bigint, symbol, function — should not appear in JSON)
  return String(value);
}

function sanitizeString(s: string, path: string, warnings: string[]): string {
  // 1. Strip null bytes and C0/C1 control characters.
  //    Keep \t (0x09), \n (0x0A), \r (0x0D) — common in address / text fields.
  // eslint-disable-next-line no-control-regex -- intentional: this code exists specifically to strip control characters
  let clean = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g, "");

  // 2. Prompt injection pattern detection and neutralization.
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      const fieldLabel = path || "<root>";
      warnings.push(
        `[LLM04] Potential prompt injection detected in field "${fieldLabel}" — ` +
          `pattern: ${pattern.source.slice(0, 60)}. Content replaced with [FLAGGED_CONTENT].`
      );
      clean = clean.replace(pattern, "[FLAGGED_CONTENT]");
    }
  }

  // 3. Per-field length cap.
  if (clean.length > MAX_FIELD_LENGTH) {
    warnings.push(
      `[LLM04] Field "${path || "<root>"}" truncated: ${clean.length} → ${MAX_FIELD_LENGTH} chars`
    );
    clean = clean.slice(0, MAX_FIELD_LENGTH) + "…[truncated]";
  }

  return clean;
}
