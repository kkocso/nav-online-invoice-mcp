#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NavClient } from "./nav-client.js";
import type { NavConfig } from "./types.js";
import { writeRateLimiter } from "./rate-limiter.js";
import { auditAttempt, auditSuccess, auditError, auditRateLimited } from "./audit-log.js";
import { sanitizeApiResponse } from "./llm-sanitizer.js";

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

function getConfig(): NavConfig {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required environment variable: ${key}`);
    return val;
  };

  const env = process.env.NAV_ENV;
  const isTest = env === "test";
  const defaultBaseUrl = isTest
    ? "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3"
    : "https://api.onlineszamla.nav.gov.hu/invoiceService/v3";

  // SSRF protection: validate custom base URL if provided
  const rawBaseUrl = process.env.NAV_BASE_URL;
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
    softwareId: process.env.NAV_SOFTWARE_ID || "NAVONLINEINVMCP-01",
    softwareName: process.env.NAV_SOFTWARE_NAME || "nav-online-invoice-mcp",
    softwareVersion: process.env.NAV_SOFTWARE_VERSION || "1.0.0",
    softwareDevName: process.env.NAV_SOFTWARE_DEV_NAME || "MCP Developer",
    softwareDevContact: process.env.NAV_SOFTWARE_DEV_CONTACT || "dev@example.com",
    softwareDevCountryCode: process.env.NAV_SOFTWARE_DEV_COUNTRY || "HU",
    softwareDevTaxNumber: process.env.NAV_SOFTWARE_DEV_TAX_NUMBER || process.env.NAV_TAX_NUMBER || "00000000",
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

const server = new McpServer({
  name: "nav-online-invoice",
  version: "1.0.0",
  description: "MCP server for the Hungarian NAV Online Invoice (Online Számla) API v3.0. Query taxpayers, search invoices, check invoice status, and submit invoices to NAV.",
  websiteUrl: "https://github.com/Szotasz/nav-online-invoice-mcp",
});

// --- Query Tools ---

server.tool("query_taxpayer", "Query taxpayer information from NAV by tax number.", { taxNumber: z.string().length(8).describe("8-digit Hungarian tax number") }, { title: "Query Taxpayer", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ taxNumber }) => { const client = new NavClient(getConfig()); const { result, data } = await client.queryTaxpayer(taxNumber); return { content: [{ type: "text", text: formatResponse(result, data) }] }; });

server.tool("query_invoice_data", "Get full invoice data by invoice number from NAV.", { invoiceNumber: z.string().describe("Invoice number"), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"), batchIndex: z.number().optional(), supplierTaxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional() }, { title: "Get Invoice Data", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber }) => { const client = new NavClient(getConfig()); const { result, data } = await client.queryInvoiceData(invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber); return { content: [{ type: "text", text: formatResponse(result, data) }] }; });

server.tool("query_invoice_digest", "Search invoices in NAV with filters.", { page: z.number().min(1).default(1), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]), dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(), insDateTimeFrom: z.string().datetime({ message: "Must be ISO 8601" }).optional(), insDateTimeTo: z.string().datetime({ message: "Must be ISO 8601" }).optional(), originalInvoiceNumber: z.string().optional(), taxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional(), name: z.string().optional(), invoiceCategory: z.enum(["NORMAL", "SIMPLIFIED", "AGGREGATE"]).optional(), paymentMethod: z.enum(["TRANSFER", "CASH", "CARD", "VOUCHER", "OTHER"]).optional(), currency: z.string().max(3).optional() }, { title: "Search Invoices", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async (params) => { const client = new NavClient(getConfig()); const { result, data } = await client.queryInvoiceDigest(params); return { content: [{ type: "text", text: formatResponse(result, data) }] }; });

server.tool("query_invoice_check", "Check if an invoice exists in NAV.", { invoiceNumber: z.string(), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]), batchIndex: z.number().optional(), supplierTaxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional() }, { title: "Check Invoice Existence", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber }) => { const client = new NavClient(getConfig()); const { result, data } = await client.queryInvoiceCheck(invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber); return { content: [{ type: "text", text: formatResponse(result, data) }] }; });

server.tool("query_invoice_chain_digest", "Query the modification chain of an invoice.", { page: z.number().min(1).default(1), invoiceNumber: z.string(), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]), taxNumber: z.string().regex(/^\d{8}$/, "Must be 8-digit tax number").optional() }, { title: "Invoice Modification Chain", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ page, invoiceNumber, invoiceDirection, taxNumber }) => { const client = new NavClient(getConfig()); const { result, data } = await client.queryInvoiceChainDigest(page, invoiceNumber, invoiceDirection, taxNumber); return { content: [{ type: "text", text: formatResponse(result, data) }] }; });

server.tool("query_transaction_status", "Check processing status of a submitted invoice transaction.", { transactionId: z.string(), returnOriginalRequest: z.boolean().default(false) }, { title: "Transaction Status", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ transactionId, returnOriginalRequest }) => { const client = new NavClient(getConfig()); const { result, data } = await client.queryTransactionStatus(transactionId, returnOriginalRequest); return { content: [{ type: "text", text: formatResponse(result, data) }] }; });

server.tool("query_transaction_list", "List transactions within a date range.", { page: z.number().min(1).default(1), insDateFrom: z.string().datetime({ message: "Must be ISO 8601" }), insDateTo: z.string().datetime({ message: "Must be ISO 8601" }), requestStatus: z.string().optional() }, { title: "List Transactions", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ page, insDateFrom, insDateTo, requestStatus }) => { const client = new NavClient(getConfig()); const { result, data } = await client.queryTransactionList(page, insDateFrom, insDateTo, requestStatus); return { content: [{ type: "text", text: formatResponse(result, data) }] }; });

// --- Write Tools ---

server.tool("manage_invoice", "⚠️ IRREVERSIBLE: Submits legally binding invoice data to the Hungarian NAV tax authority (create, modify, or storno). This action has real legal and financial consequences and CANNOT be undone without filing a correction. ALWAYS ask the user for explicit confirmation before calling this tool.", { operations: z.array(z.object({ index: z.number().min(1).max(100), operation: z.enum(["CREATE", "MODIFY", "STORNO"]), invoiceData: z.string(), electronicInvoiceHash: z.string().optional() })).min(1).max(100), compressed: z.boolean().default(false) }, { title: "Submit Invoice", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, async ({ operations, compressed }) => {
  const rateCheck = writeRateLimiter.check("manage_invoice");
  if (!rateCheck.allowed) {
    auditRateLimited("manage_invoice", operations.length, rateCheck.callCount);
    return { content: [{ type: "text", text: `## Blocked\n${rateCheck.warning}` }], isError: true };
  }
  const warningPrefix = rateCheck.warning ? `> ${rateCheck.warning}\n\n` : "";
  auditAttempt("manage_invoice", operations.length);
  const client = new NavClient(getConfig());
  const { result, data, transactionId } = await client.manageInvoice(operations, compressed);
  if (result.funcCode === "OK") { auditSuccess("manage_invoice", operations.length, transactionId, result.funcCode); }
  else { auditError("manage_invoice", operations.length, result.funcCode, result.errorCode); }
  const response = formatResponse(result, data); const extra = transactionId ? `\n**Transaction ID**: \`${transactionId}\`` : ""; return { content: [{ type: "text", text: warningPrefix + response + extra }] };
});

server.tool("manage_annulment", "⚠️ IRREVERSIBLE: Submits a technical annulment to NAV for invoices with critical data errors. Permanently marks the invoice as annulled. ALWAYS ask the user for explicit confirmation before calling this tool.", { operations: z.array(z.object({ index: z.number().min(1).max(100), annulmentData: z.string() })).min(1).max(100) }, { title: "Annul Invoice", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, async ({ operations }) => {
  const rateCheck = writeRateLimiter.check("manage_annulment");
  if (!rateCheck.allowed) {
    auditRateLimited("manage_annulment", operations.length, rateCheck.callCount);
    return { content: [{ type: "text", text: `## Blocked\n${rateCheck.warning}` }], isError: true };
  }
  const warningPrefix = rateCheck.warning ? `> ${rateCheck.warning}\n\n` : "";
  auditAttempt("manage_annulment", operations.length);
  const client = new NavClient(getConfig());
  const { result, data, transactionId } = await client.manageAnnulment(operations);
  if (result.funcCode === "OK") { auditSuccess("manage_annulment", operations.length, transactionId, result.funcCode); }
  else { auditError("manage_annulment", operations.length, result.funcCode, result.errorCode); }
  const response = formatResponse(result, data); const extra = transactionId ? `\n**Transaction ID**: \`${transactionId}\`` : ""; return { content: [{ type: "text", text: warningPrefix + response + extra }] };
});

// --- Prompts ---

server.prompt("search-invoices", "Search for invoices issued or received within a date range", { direction: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"), dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").describe("Start date (YYYY-MM-DD)"), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").describe("End date (YYYY-MM-DD)") }, ({ direction, dateFrom, dateTo }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `Search for ${direction === "OUTBOUND" ? "issued" : "received"} invoices from ${dateFrom} to ${dateTo} using the query_invoice_digest tool. Show the results in a clear table format with invoice number, date, partner name, and amount.` } }] }));

server.prompt("check-taxpayer", "Look up a Hungarian taxpayer by their tax number", { taxNumber: z.string().describe("8-digit Hungarian tax number") }, ({ taxNumber }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `Look up taxpayer information for tax number ${taxNumber} using the query_taxpayer tool. Show the company name, full address, and VAT status.` } }] }));

server.prompt("invoice-details", "Get complete details of a specific invoice", { invoiceNumber: z.string().describe("Invoice number to look up"), direction: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued") }, ({ invoiceNumber, direction }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `Get the full details of invoice ${invoiceNumber} (${direction === "OUTBOUND" ? "issued" : "received"}) using the query_invoice_data tool. Show all relevant information including items, amounts, tax details, and partner information.` } }] }));

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("NAV Online Invoice MCP server running on stdio");
}).catch((error) => {
  // Log only the error message (not the full object) to avoid leaking sensitive data
  const msg = error instanceof Error ? error.message : String(error);
  console.error("Fatal error:", msg);
  process.exit(1);
});
