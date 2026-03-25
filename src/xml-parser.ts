import { XMLParser } from "fast-xml-parser";

// Security hardening for XML parsing:
//
// processEntities: false  — disables XML entity expansion, preventing "Billion Laughs"
//                           DoS attacks (CWE-776) and entity injection. NAV API responses
//                           should never contain custom entities, so this is safe to disable.
//
// allowBooleanAttributes: false — prevents attribute injection edge cases.
//
// Classic XXE (external entity fetching) is not applicable here because fast-xml-parser
// is a pure-JS parser that never makes network requests; it has no DTD loader.
// The processEntities flag handles the entity expansion vector instead.
//
// Reference: OWASP XML Security Cheat Sheet
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: false,
  allowBooleanAttributes: false,
  isArray: (name) => {
    const arrayElements = [
      "invoiceDigest",
      "invoiceOperation",
      "annulmentOperation",
      "line",
      "processingResult",
      "technicalValidationMessages",
      "businessValidationMessages",
      "notification",
      "transaction",
      "invoiceChainDigest",
      "invoiceChainElement",
    ];
    return arrayElements.includes(name);
  },
});

export function parseXmlResponse(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

export function extractResult(parsed: Record<string, unknown>): {
  funcCode: string;
  errorCode?: string;
  message?: string;
  notifications?: unknown[];
} {
  // Find the response root element (ends with "Response")
  const rootKey = Object.keys(parsed).find((k) => k.endsWith("Response"));
  if (!rootKey) {
    return { funcCode: "ERROR", message: "Invalid response structure" };
  }

  // eslint-disable-next-line security/detect-object-injection -- rootKey is validated via .find() against trusted parsed XML keys
  const root = parsed[rootKey] as Record<string, unknown>;
  const result = root.result as Record<string, unknown> | undefined;

  if (!result) {
    return { funcCode: "ERROR", message: "No result element in response" };
  }

  const funcCode = (result.funcCode as string) || "ERROR";
  const errorCode = result.errorCode as string | undefined;
  const message = result.message as string | undefined;

  const notifications = result.notifications as unknown[] | undefined;

  return { funcCode, errorCode, message, notifications };
}

export function extractResponseData(
  parsed: Record<string, unknown>
): Record<string, unknown> | undefined {
  const rootKey = Object.keys(parsed).find((k) => k.endsWith("Response"));
  if (!rootKey) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- rootKey is validated via .find() against trusted parsed XML keys
  return parsed[rootKey] as Record<string, unknown>;
}
