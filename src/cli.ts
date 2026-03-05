#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NavClient } from "./nav-client.js";
import type { NavConfig } from "./types.js";

function getConfig(): NavConfig {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required environment variable: ${key}`);
    return val;
  };

  const env = process.env.NAV_ENV;
  const isTest = env === "test";
  const baseUrl = isTest
    ? "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3"
    : "https://api.onlineszamla.nav.gov.hu/invoiceService/v3";

  return {
    login: required("NAV_LOGIN"),
    password: required("NAV_PASSWORD"),
    taxNumber: required("NAV_TAX_NUMBER"),
    signatureKey: required("NAV_SIGNATURE_KEY"),
    exchangeKey: required("NAV_EXCHANGE_KEY"),
    baseUrl: process.env.NAV_BASE_URL || baseUrl,
    softwareId: process.env.NAV_SOFTWARE_ID || "NAVONLINEINVMCP-01",
    softwareName: process.env.NAV_SOFTWARE_NAME || "nav-online-invoice-mcp",
    softwareVersion: process.env.NAV_SOFTWARE_VERSION || "1.0.0",
    softwareDevName: process.env.NAV_SOFTWARE_DEV_NAME || "MCP Developer",
    softwareDevContact: process.env.NAV_SOFTWARE_DEV_CONTACT || "dev@example.com",
    softwareDevCountryCode: process.env.NAV_SOFTWARE_DEV_COUNTRY || "HU",
    softwareDevTaxNumber: process.env.NAV_SOFTWARE_DEV_TAX_NUMBER || process.env.NAV_TAX_NUMBER || "00000000",
  };
}

function formatResponse(result: { funcCode: string; errorCode?: string; message?: string }, data: unknown, rawXml?: string): string {
  const parts: string[] = [];
  if (result.funcCode !== "OK") {
    parts.push(`## Error`);
    parts.push(`- **Status**: ${result.funcCode}`);
    if (result.errorCode) parts.push(`- **Error Code**: ${result.errorCode}`);
    if (result.message) parts.push(`- **Message**: ${result.message}`);
    if (rawXml) parts.push(`\n### Raw Response\n\`\`\`xml\n${rawXml}\n\`\`\``);
    return parts.join("\n");
  }
  parts.push(`## Success`);
  parts.push("```json");
  parts.push(JSON.stringify(data, null, 2));
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

server.tool("query_taxpayer", "Query taxpayer information from NAV by tax number.", { taxNumber: z.string().length(8).describe("8-digit Hungarian tax number") }, { title: "Query Taxpayer", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ taxNumber }) => { const client = new NavClient(getConfig()); const { result, data, rawXml } = await client.queryTaxpayer(taxNumber); return { content: [{ type: "text", text: formatResponse(result, data, rawXml) }] }; });

server.tool("query_invoice_data", "Get full invoice data by invoice number from NAV.", { invoiceNumber: z.string().describe("Invoice number"), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"), batchIndex: z.number().optional(), supplierTaxNumber: z.string().optional() }, { title: "Get Invoice Data", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber }) => { const client = new NavClient(getConfig()); const { result, data, rawXml } = await client.queryInvoiceData(invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber); return { content: [{ type: "text", text: formatResponse(result, data, rawXml) }] }; });

server.tool("query_invoice_digest", "Search invoices in NAV with filters.", { page: z.number().min(1).default(1), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]), dateFrom: z.string().optional(), dateTo: z.string().optional(), insDateTimeFrom: z.string().optional(), insDateTimeTo: z.string().optional(), originalInvoiceNumber: z.string().optional(), taxNumber: z.string().optional(), name: z.string().optional(), invoiceCategory: z.enum(["NORMAL", "SIMPLIFIED", "AGGREGATE"]).optional(), paymentMethod: z.enum(["TRANSFER", "CASH", "CARD", "VOUCHER", "OTHER"]).optional(), currency: z.string().optional() }, { title: "Search Invoices", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async (params) => { const client = new NavClient(getConfig()); const { result, data, rawXml } = await client.queryInvoiceDigest(params); return { content: [{ type: "text", text: formatResponse(result, data, rawXml) }] }; });

server.tool("query_invoice_check", "Check if an invoice exists in NAV.", { invoiceNumber: z.string(), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]), batchIndex: z.number().optional(), supplierTaxNumber: z.string().optional() }, { title: "Check Invoice Existence", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber }) => { const client = new NavClient(getConfig()); const { result, data, rawXml } = await client.queryInvoiceCheck(invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber); return { content: [{ type: "text", text: formatResponse(result, data, rawXml) }] }; });

server.tool("query_invoice_chain_digest", "Query the modification chain of an invoice.", { page: z.number().min(1).default(1), invoiceNumber: z.string(), invoiceDirection: z.enum(["INBOUND", "OUTBOUND"]), taxNumber: z.string().optional() }, { title: "Invoice Modification Chain", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ page, invoiceNumber, invoiceDirection, taxNumber }) => { const client = new NavClient(getConfig()); const { result, data, rawXml } = await client.queryInvoiceChainDigest(page, invoiceNumber, invoiceDirection, taxNumber); return { content: [{ type: "text", text: formatResponse(result, data, rawXml) }] }; });

server.tool("query_transaction_status", "Check processing status of a submitted invoice transaction.", { transactionId: z.string(), returnOriginalRequest: z.boolean().default(false) }, { title: "Transaction Status", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ transactionId, returnOriginalRequest }) => { const client = new NavClient(getConfig()); const { result, data, rawXml } = await client.queryTransactionStatus(transactionId, returnOriginalRequest); return { content: [{ type: "text", text: formatResponse(result, data, rawXml) }] }; });

server.tool("query_transaction_list", "List transactions within a date range.", { page: z.number().min(1).default(1), insDateFrom: z.string(), insDateTo: z.string(), requestStatus: z.string().optional() }, { title: "List Transactions", readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ page, insDateFrom, insDateTo, requestStatus }) => { const client = new NavClient(getConfig()); const { result, data, rawXml } = await client.queryTransactionList(page, insDateFrom, insDateTo, requestStatus); return { content: [{ type: "text", text: formatResponse(result, data, rawXml) }] }; });

// --- Write Tools ---

server.tool("manage_invoice", "Submit invoice data to NAV (create, modify, or storno).", { operations: z.array(z.object({ index: z.number().min(1).max(100), operation: z.enum(["CREATE", "MODIFY", "STORNO"]), invoiceData: z.string(), electronicInvoiceHash: z.string().optional() })).min(1).max(100), compressed: z.boolean().default(false) }, { title: "Submit Invoice", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, async ({ operations, compressed }) => { const client = new NavClient(getConfig()); const { result, data, rawXml, transactionId } = await client.manageInvoice(operations, compressed); const response = formatResponse(result, data, rawXml); const extra = transactionId ? `\n**Transaction ID**: \`${transactionId}\`` : ""; return { content: [{ type: "text", text: response + extra }] }; });

server.tool("manage_annulment", "Submit technical annulment for invoices.", { operations: z.array(z.object({ index: z.number().min(1).max(100), annulmentData: z.string() })).min(1).max(100) }, { title: "Annul Invoice", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, async ({ operations }) => { const client = new NavClient(getConfig()); const { result, data, rawXml, transactionId } = await client.manageAnnulment(operations); const response = formatResponse(result, data, rawXml); const extra = transactionId ? `\n**Transaction ID**: \`${transactionId}\`` : ""; return { content: [{ type: "text", text: response + extra }] }; });

// --- Prompts ---

server.prompt("search-invoices", "Search for invoices issued or received within a date range", { direction: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued"), dateFrom: z.string().describe("Start date (YYYY-MM-DD)"), dateTo: z.string().describe("End date (YYYY-MM-DD)") }, ({ direction, dateFrom, dateTo }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `Search for ${direction === "OUTBOUND" ? "issued" : "received"} invoices from ${dateFrom} to ${dateTo} using the query_invoice_digest tool. Show the results in a clear table format with invoice number, date, partner name, and amount.` } }] }));

server.prompt("check-taxpayer", "Look up a Hungarian taxpayer by their tax number", { taxNumber: z.string().describe("8-digit Hungarian tax number") }, ({ taxNumber }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `Look up taxpayer information for tax number ${taxNumber} using the query_taxpayer tool. Show the company name, full address, and VAT status.` } }] }));

server.prompt("invoice-details", "Get complete details of a specific invoice", { invoiceNumber: z.string().describe("Invoice number to look up"), direction: z.enum(["INBOUND", "OUTBOUND"]).describe("INBOUND = received, OUTBOUND = issued") }, ({ invoiceNumber, direction }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `Get the full details of invoice ${invoiceNumber} (${direction === "OUTBOUND" ? "issued" : "received"}) using the query_invoice_data tool. Show all relevant information including items, amounts, tax details, and partner information.` } }] }));

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("NAV Online Invoice MCP server running on stdio");
}).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
