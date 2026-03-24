import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NavClient } from "./nav-client.js";
import type { NavConfig } from "./types.js";
import { writeRateLimiter } from "./rate-limiter.js";
import { auditAttempt, auditSuccess, auditError, auditRateLimited } from "./audit-log.js";
import { sanitizeApiResponse } from "./llm-sanitizer.js";

// Smithery config schema — exported so Smithery auto-generates the config UI
export const configSchema = z.object({
  NAV_LOGIN: z.string().describe("NAV Online Invoice API login username"),
  NAV_PASSWORD: z.string().describe("NAV Online Invoice API password"),
  NAV_TAX_NUMBER: z.string().describe("8-digit Hungarian tax number (adoszam)"),
  NAV_SIGNATURE_KEY: z.string().describe("NAV API XML signature key"),
  NAV_EXCHANGE_KEY: z.string().describe("NAV API data exchange key"),
  NAV_ENV: z.enum(["test", "production"]).default("production").describe("NAV environment (test or production)"),
  NAV_SOFTWARE_ID: z.string().default("NAVONLINEINVMCP-01").describe("Registered software ID at NAV"),
  NAV_SOFTWARE_DEV_NAME: z.string().default("MCP Developer").describe("Software developer name"),
  NAV_SOFTWARE_DEV_CONTACT: z.string().default("dev@example.com").describe("Software developer contact email"),
  NAV_SOFTWARE_DEV_TAX_NUMBER: z.string().default("00000000").describe("Software developer tax number"),
});

type SmitheryConfig = z.infer<typeof configSchema>;

const NAV_ALLOWED_BASE_URLS = [
  "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3",
  "https://api.onlineszamla.nav.gov.hu/invoiceService/v3",
];

function validateBaseUrl(url: string): string {
  // SSRF protection: only allow official NAV API endpoints
  if (!NAV_ALLOWED_BASE_URLS.includes(url)) {
    throw new Error(
      `NAV_BASE_URL "${url}" is not an allowed endpoint. ` +
      `Allowed: ${NAV_ALLOWED_BASE_URLS.join(", ")}`
    );
  }
  return url;
}

function getConfig(config?: Partial<SmitheryConfig>): NavConfig {
  const get = (key: string): string | undefined =>
    config?.[key as keyof SmitheryConfig] || process.env[key];

  const required = (key: string): string => {
    const val = get(key);
    if (!val) throw new Error(`Missing required config: ${key}`);
    return val;
  };

  const env = get("NAV_ENV");
  const isTest = env === "test";
  const defaultBaseUrl = isTest
    ? "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3"
    : "https://api.onlineszamla.nav.gov.hu/invoiceService/v3";

  // SSRF protection: validate custom base URL if provided
  const rawBaseUrl = get("NAV_BASE_URL");
  const baseUrl = rawBaseUrl ? validateBaseUrl(rawBaseUrl) : defaultBaseUrl;

  // Validate exchangeKey length before AES-128 use (requires ≥16 bytes)
  const exchangeKey = required("NAV_EXCHANGE_KEY");
  if (Buffer.from(exchangeKey, "utf8").length < 16) {
    throw new Error(
      "NAV_EXCHANGE_KEY must be at least 16 characters long (required for AES-128 decryption)"
    );
  }

  return {
    login: required("NAV_LOGIN"),
    password: required("NAV_PASSWORD"),
    taxNumber: required("NAV_TAX_NUMBER"),
    signatureKey: required("NAV_SIGNATURE_KEY"),
    exchangeKey,
    baseUrl,
    softwareId: get("NAV_SOFTWARE_ID") || "NAVONLINEINVMCP-01",
    softwareName: get("NAV_SOFTWARE_NAME") || "nav-online-invoice-mcp",
    softwareVersion: get("NAV_SOFTWARE_VERSION") || "1.0.0",
    softwareDevName: get("NAV_SOFTWARE_DEV_NAME") || "MCP Developer",
    softwareDevContact: get("NAV_SOFTWARE_DEV_CONTACT") || "dev@example.com",
    softwareDevCountryCode: get("NAV_SOFTWARE_DEV_COUNTRY") || "HU",
    softwareDevTaxNumber: get("NAV_SOFTWARE_DEV_TAX_NUMBER") || get("NAV_TAX_NUMBER") || "00000000",
  };
}

function formatResponse(result: { funcCode: string; errorCode?: string; message?: string }, data: unknown): string {
  const parts: string[] = [];

  if (result.funcCode !== "OK") {
    parts.push(`## Error`);
    // LLM04: sanitize error fields from NAV API before returning to LLM context
    const { data: sanitizedErr } = sanitizeApiResponse({
      funcCode: result.funcCode,
      errorCode: result.errorCode,
      message: result.message,
    }) as { data: Record<string, string | undefined> };
    parts.push(`- **Status**: ${sanitizedErr.funcCode ?? result.funcCode}`);
    if (sanitizedErr.errorCode) parts.push(`- **Error Code**: ${sanitizedErr.errorCode}`);
    if (sanitizedErr.message) parts.push(`- **Message**: ${sanitizedErr.message}`);
    // rawXml intentionally omitted — may contain sensitive credential hashes or PII
    return parts.join("\n");
  }

  // LLM04 mitigation: sanitize NAV API response before injecting into LLM context.
  // Strips control chars, detects prompt injection patterns, caps field + total size.
  const { data: sanitized, warnings } = sanitizeApiResponse(data);

  if (warnings.length > 0) {
    // Emit warnings to stderr audit trail (never exposed to LLM as actionable text)
    process.stderr.write(
      JSON.stringify({ timestamp: new Date().toISOString(), event: "llm04.sanitizer.warning", warnings }) + "\n"
    );
    parts.push(`> ⚠️ **Data sanitization notice**: ${warnings.length} anomaly/anomalies detected in NAV API response and neutralized. See server logs for details.`);
  }

  parts.push(`## Success`);
  parts.push("```json");
  parts.push(JSON.stringify(sanitized, null, 2));
  parts.push("```");
  return parts.join("\n");
}

// Smithery calls: default({ config }) — destructured object with config key
export default function createServer({ config }: { config: Partial<SmitheryConfig> }) {
  const server = new McpServer({
    name: "nav-online-invoice",
    version: "1.0.0",
    description: "MCP server for the Hungarian NAV Online Invoice (Online Számla) API v3.0. Query taxpayers, search invoices, check invoice status, and submit invoices to NAV.",
    websiteUrl: "https://github.com/Szotasz/nav-online-invoice-mcp",
  });

  // --- Query Tools (read-only, safe) ---

  server.tool(
    "query_taxpayer",
    "Query taxpayer information from NAV by tax number (adoszam). Returns company name, address, VAT status.",
    {
      taxNumber: z.string().length(8).describe("8-digit Hungarian tax number (adoszam)"),
    },
    { title: "Query Taxpayer", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ taxNumber }) => {
      const client = new NavClient(getConfig(config));
      const { result, data } = await client.queryTaxpayer(taxNumber);
      return { content: [{ type: "text", text: formatResponse(result, data) }] };
    }
  );

  server.tool(
    "query_invoice_data",
    "Get full invoice data by invoice number from NAV. Returns complete invoice details.",
    {
      invoiceNumber: z.string().describe("Invoice number (szamlaszam)"),
      invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received invoices, OUTBOUND = issued invoices"),
      batchIndex: z.number().optional().describe("Batch index if part of a batch invoice"),
      supplierTaxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional().describe("Supplier tax number (only for INBOUND)"),
    },
    { title: "Get Invoice Data", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber }) => {
      const client = new NavClient(getConfig(config));
      const { result, data } = await client.queryInvoiceData(
        invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber
      );
      return { content: [{ type: "text", text: formatResponse(result, data) }] };
    }
  );

  server.tool(
    "query_invoice_digest",
    "Search invoices in NAV with filters. Returns a paginated list of invoice summaries. Must provide either date range (dateFrom/dateTo), insertion date range (insDateTimeFrom/insDateTimeTo), or originalInvoiceNumber.",
    {
      page: z.number().min(1).default(1).describe("Page number (1-based)"),
      invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional().describe("Invoice issue date from (YYYY-MM-DD)"),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional().describe("Invoice issue date to (YYYY-MM-DD)"),
      insDateTimeFrom: z.string().datetime({ message: "Must be ISO 8601 datetime" }).optional().describe("Insertion datetime from (ISO 8601)"),
      insDateTimeTo: z.string().datetime({ message: "Must be ISO 8601 datetime" }).optional().describe("Insertion datetime to (ISO 8601)"),
      originalInvoiceNumber: z.string().optional().describe("Original invoice number for modifications"),
      taxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional().describe("Partner tax number filter"),
      name: z.string().optional().describe("Partner name filter"),
      invoiceCategory: z.enum(["NORMAL", "SIMPLIFIED", "AGGREGATE"]).optional(),
      paymentMethod: z.enum(["TRANSFER", "CASH", "CARD", "VOUCHER", "OTHER"]).optional(),
      currency: z.string().max(3).optional().describe("Currency code (e.g. HUF, EUR)"),
    },
    { title: "Search Invoices", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      const client = new NavClient(getConfig(config));
      const { result, data } = await client.queryInvoiceDigest(params);
      return { content: [{ type: "text", text: formatResponse(result, data) }] };
    }
  );

  server.tool(
    "query_invoice_check",
    "Check if an invoice exists in NAV system.",
    {
      invoiceNumber: z.string().describe("Invoice number"),
      invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]),
      batchIndex: z.number().optional(),
      supplierTaxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional(),
    },
    { title: "Check Invoice Existence", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber }) => {
      const client = new NavClient(getConfig(config));
      const { result, data } = await client.queryInvoiceCheck(
        invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber
      );
      return { content: [{ type: "text", text: formatResponse(result, data) }] };
    }
  );

  server.tool(
    "query_invoice_chain_digest",
    "Query the modification chain of an invoice (original + all modifications/stornos).",
    {
      page: z.number().min(1).default(1),
      invoiceNumber: z.string().describe("Original invoice number"),
      invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]),
      taxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional().describe("Partner tax number"),
    },
    { title: "Invoice Modification Chain", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ page, invoiceNumber, invoiceDirection, taxNumber }) => {
      const client = new NavClient(getConfig(config));
      const { result, data } = await client.queryInvoiceChainDigest(
        page, invoiceNumber, invoiceDirection, taxNumber
      );
      return { content: [{ type: "text", text: formatResponse(result, data) }] };
    }
  );

  server.tool(
    "query_transaction_status",
    "Check the processing status of a previously submitted invoice transaction.",
    {
      transactionId: z.string().describe("Transaction ID from manageInvoice response"),
      returnOriginalRequest: z.boolean().default(false).describe("Include original request data"),
    },
    { title: "Transaction Status", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ transactionId, returnOriginalRequest }) => {
      const client = new NavClient(getConfig(config));
      const { result, data } = await client.queryTransactionStatus(
        transactionId, returnOriginalRequest
      );
      return { content: [{ type: "text", text: formatResponse(result, data) }] };
    }
  );

  server.tool(
    "query_transaction_list",
    "List transactions within a date range.",
    {
      page: z.number().min(1).default(1),
      insDateFrom: z.string().datetime({ message: "Must be ISO 8601 datetime" }).describe("From datetime (ISO 8601)"),
      insDateTo: z.string().datetime({ message: "Must be ISO 8601 datetime" }).describe("To datetime (ISO 8601)"),
      requestStatus: z.string().optional().describe("Filter by status"),
    },
    { title: "List Transactions", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ page, insDateFrom, insDateTo, requestStatus }) => {
      const client = new NavClient(getConfig(config));
      const { result, data } = await client.queryTransactionList(
        page, insDateFrom, insDateTo, requestStatus
      );
      return { content: [{ type: "text", text: formatResponse(result, data) }] };
    }
  );

  // --- Write Tools (modifying operations) ---

  server.tool(
    "manage_invoice",
    "⚠️ IRREVERSIBLE: Submits legally binding invoice data to the Hungarian NAV tax authority (create, modify, or storno). This action has real legal and financial consequences and CANNOT be undone without filing a correction. ALWAYS ask the user for explicit confirmation before calling this tool. Handles token exchange automatically. The invoiceData must be BASE64-encoded invoice XML conforming to NAV invoiceData XSD.",
    {
      operations: z
        .array(
          z.object({
            index: z.number().min(1).max(100),
            operation: z.enum(["CREATE", "MODIFY", "STORNO"]),
            invoiceData: z.string().describe("BASE64-encoded invoice XML"),
            electronicInvoiceHash: z.string().optional().describe("SHA3-512 hash for electronic invoices"),
          })
        )
        .min(1)
        .max(100)
        .describe("Array of invoice operations (max 100)"),
      compressed: z.boolean().default(false).describe("Whether invoiceData is GZIP compressed"),
    },
    { title: "Submit Invoice", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ operations, compressed }) => {
      const rateCheck = writeRateLimiter.check("manage_invoice");
      if (!rateCheck.allowed) {
        auditRateLimited("manage_invoice", operations.length, rateCheck.callCount);
        return { content: [{ type: "text", text: `## Blocked\n${rateCheck.warning}` }], isError: true };
      }
      const warningPrefix = rateCheck.warning ? `> ${rateCheck.warning}\n\n` : "";

      auditAttempt("manage_invoice", operations.length);
      const client = new NavClient(getConfig(config));
      const { result, data, transactionId } = await client.manageInvoice(operations, compressed);

      if (result.funcCode === "OK") {
        auditSuccess("manage_invoice", operations.length, transactionId, result.funcCode);
      } else {
        auditError("manage_invoice", operations.length, result.funcCode, result.errorCode);
      }

      const response = formatResponse(result, data);
      const extra = transactionId ? `\n**Transaction ID**: \`${transactionId}\`` : "";
      return { content: [{ type: "text", text: warningPrefix + response + extra }] };
    }
  );

  server.tool(
    "manage_annulment",
    "⚠️ IRREVERSIBLE: Submits a technical annulment to NAV for invoices with critical data errors (wrong invoice number, wrong issue date, incorrect electronic hash). This permanently marks the invoice as annulled in the NAV system. ALWAYS ask the user for explicit confirmation before calling this tool.",
    {
      operations: z
        .array(
          z.object({
            index: z.number().min(1).max(100),
            annulmentData: z.string().describe("BASE64-encoded annulment XML"),
          })
        )
        .min(1)
        .max(100),
    },
    { title: "Annul Invoice", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ operations }) => {
      const rateCheck = writeRateLimiter.check("manage_annulment");
      if (!rateCheck.allowed) {
        auditRateLimited("manage_annulment", operations.length, rateCheck.callCount);
        return { content: [{ type: "text", text: `## Blocked\n${rateCheck.warning}` }], isError: true };
      }
      const warningPrefix = rateCheck.warning ? `> ${rateCheck.warning}\n\n` : "";

      auditAttempt("manage_annulment", operations.length);
      const client = new NavClient(getConfig(config));
      const { result, data, transactionId } = await client.manageAnnulment(operations);

      if (result.funcCode === "OK") {
        auditSuccess("manage_annulment", operations.length, transactionId, result.funcCode);
      } else {
        auditError("manage_annulment", operations.length, result.funcCode, result.errorCode);
      }

      const response = formatResponse(result, data);
      const extra = transactionId ? `\n**Transaction ID**: \`${transactionId}\`` : "";
      return { content: [{ type: "text", text: warningPrefix + response + extra }] };
    }
  );

  // --- Prompts ---

  server.prompt(
    "search-invoices",
    "Search for invoices issued or received within a date range",
    {
      direction: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").describe("End date (YYYY-MM-DD)"),
    },
    ({ direction, dateFrom, dateTo }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Search for ${direction === "OUTBOUND" ? "issued" : "received"} invoices from ${dateFrom} to ${dateTo} using the query_invoice_digest tool. Show the results in a clear table format with invoice number, date, partner name, and amount.`,
        },
      }],
    })
  );

  server.prompt(
    "check-taxpayer",
    "Look up a Hungarian taxpayer by their tax number",
    {
      taxNumber: z.string().describe("8-digit Hungarian tax number"),
    },
    ({ taxNumber }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Look up taxpayer information for tax number ${taxNumber} using the query_taxpayer tool. Show the company name, full address, and VAT status.`,
        },
      }],
    })
  );

  server.prompt(
    "invoice-details",
    "Get complete details of a specific invoice",
    {
      invoiceNumber: z.string().describe("Invoice number to look up"),
      direction: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"),
    },
    ({ invoiceNumber, direction }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Get the full details of invoice ${invoiceNumber} (${direction === "OUTBOUND" ? "issued" : "received"}) using the query_invoice_data tool. Show all relevant information including items, amounts, tax details, and partner information.`,
        },
      }],
    })
  );

  // Smithery expects server.server (the low-level Server instance)
  return server.server;
}

/**
 * SANDBOX SERVER — FOR SMITHERY TOOL SCANNING ONLY
 *
 * This function is called by Smithery to introspect available tools without
 * real credentials. It MUST NOT be used in production.
 *
 * Security notes:
 * - NAV_EXCHANGE_KEY "sandbox_key_16x!" is a dummy 16-char key to satisfy the
 *   AES-128 length requirement without triggering a startup error.
 * - These credentials will never authenticate successfully with real NAV endpoints.
 * - The server is always set to NAV_ENV="test" to prevent accidental production calls.
 */
export function createSandboxServer() {
  return createServer({
    config: {
      NAV_LOGIN: "sandbox",
      NAV_PASSWORD: "sandbox",
      NAV_TAX_NUMBER: "00000000",
      NAV_SIGNATURE_KEY: "sandbox",
      NAV_EXCHANGE_KEY: "sandbox_key_16x!", // 16+ chars to satisfy AES-128 validation
      NAV_ENV: "test" as const,
    },
  });
}
