import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
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
  return parsed[rootKey] as Record<string, unknown>;
}
