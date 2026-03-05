import type { NavConfig } from "./types.js";
import {
  computePasswordHash,
  computeRequestSignature,
  generateRequestId,
} from "./crypto.js";

const API_NS = "http://schemas.nav.gov.hu/OSA/3.0/api";
const COMMON_NS = "http://schemas.nav.gov.hu/NTCA/1.0/common";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getTimestamp(): string {
  return new Date().toISOString().replace(/Z$/, "").replace(/(\.\d{3})\d*/, "$1") + "Z";
}

function buildHeader(requestId: string, timestamp: string): string {
  return `
  <common:header>
    <common:requestId>${escapeXml(requestId)}</common:requestId>
    <common:timestamp>${timestamp}</common:timestamp>
    <common:requestVersion>3.0</common:requestVersion>
    <common:headerVersion>1.0</common:headerVersion>
  </common:header>`;
}

function buildUser(
  config: NavConfig,
  requestId: string,
  timestamp: string,
  invoiceHashes?: string[]
): string {
  const passwordHash = computePasswordHash(config.password);
  const requestSignature = computeRequestSignature(
    requestId,
    timestamp,
    config.signatureKey,
    invoiceHashes
  );

  return `
  <common:user>
    <common:login>${escapeXml(config.login)}</common:login>
    <common:passwordHash cryptoType="SHA-512">${passwordHash}</common:passwordHash>
    <common:taxNumber>${escapeXml(config.taxNumber)}</common:taxNumber>
    <common:requestSignature cryptoType="SHA3-512">${requestSignature}</common:requestSignature>
  </common:user>`;
}

function buildSoftware(config: NavConfig): string {
  return `
  <software>
    <softwareId>${escapeXml(config.softwareId)}</softwareId>
    <softwareName>${escapeXml(config.softwareName)}</softwareName>
    <softwareOperation>LOCAL_SOFTWARE</softwareOperation>
    <softwareMainVersion>${escapeXml(config.softwareVersion)}</softwareMainVersion>
    <softwareDevName>${escapeXml(config.softwareDevName)}</softwareDevName>
    <softwareDevContact>${escapeXml(config.softwareDevContact)}</softwareDevContact>
    <softwareDevCountryCode>${escapeXml(config.softwareDevCountryCode)}</softwareDevCountryCode>
    <softwareDevTaxNumber>${escapeXml(config.softwareDevTaxNumber)}</softwareDevTaxNumber>
  </software>`;
}

export function buildRequest(
  operationName: string,
  config: NavConfig,
  bodyXml: string,
  invoiceHashes?: string[]
): { xml: string; requestId: string } {
  const requestId = generateRequestId();
  const timestamp = getTimestamp();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<${operationName}Request xmlns="${API_NS}" xmlns:common="${COMMON_NS}">${buildHeader(requestId, timestamp)}${buildUser(config, requestId, timestamp, invoiceHashes)}${buildSoftware(config)}
  ${bodyXml}
</${operationName}Request>`;

  return { xml, requestId };
}

export function buildTokenExchangeBody(): string {
  return "";
}

export function buildQueryInvoiceDataBody(
  invoiceNumber: string,
  invoiceDirection: string,
  batchIndex?: number,
  supplierTaxNumber?: string
): string {
  let body = `<invoiceNumberQuery>
    <invoiceNumber>${escapeXml(invoiceNumber)}</invoiceNumber>
    <invoiceDirection>${escapeXml(invoiceDirection)}</invoiceDirection>`;
  if (batchIndex !== undefined) {
    body += `\n    <batchIndex>${Number(batchIndex)}</batchIndex>`;
  }
  if (supplierTaxNumber) {
    body += `\n    <supplierTaxNumber>${escapeXml(supplierTaxNumber)}</supplierTaxNumber>`;
  }
  body += `\n  </invoiceNumberQuery>`;
  return body;
}

export function buildQueryInvoiceDigestBody(params: {
  page: number;
  invoiceDirection: string;
  dateFrom?: string;
  dateTo?: string;
  insDateTimeFrom?: string;
  insDateTimeTo?: string;
  originalInvoiceNumber?: string;
  taxNumber?: string;
  name?: string;
  invoiceCategory?: string;
  paymentMethod?: string;
  invoiceAppearance?: string;
  source?: string;
  currency?: string;
}): string {
  let mandatory = "";
  if (params.dateFrom && params.dateTo) {
    mandatory = `<invoiceIssueDate>
        <dateFrom>${escapeXml(params.dateFrom)}</dateFrom>
        <dateTo>${escapeXml(params.dateTo)}</dateTo>
      </invoiceIssueDate>`;
  } else if (params.insDateTimeFrom && params.insDateTimeTo) {
    mandatory = `<insDate>
        <dateTimeFrom>${escapeXml(params.insDateTimeFrom)}</dateTimeFrom>
        <dateTimeTo>${escapeXml(params.insDateTimeTo)}</dateTimeTo>
      </insDate>`;
  } else if (params.originalInvoiceNumber) {
    mandatory = `<originalInvoiceNumber>${escapeXml(params.originalInvoiceNumber)}</originalInvoiceNumber>`;
  }

  let additional = "";
  const addParams: string[] = [];
  if (params.taxNumber) addParams.push(`<taxNumber>${escapeXml(params.taxNumber)}</taxNumber>`);
  if (params.name) addParams.push(`<name>${escapeXml(params.name)}</name>`);
  if (params.invoiceCategory) addParams.push(`<invoiceCategory>${escapeXml(params.invoiceCategory)}</invoiceCategory>`);
  if (params.paymentMethod) addParams.push(`<paymentMethod>${escapeXml(params.paymentMethod)}</paymentMethod>`);
  if (params.invoiceAppearance) addParams.push(`<invoiceAppearance>${escapeXml(params.invoiceAppearance)}</invoiceAppearance>`);
  if (params.source) addParams.push(`<source>${escapeXml(params.source)}</source>`);
  if (params.currency) addParams.push(`<currency>${escapeXml(params.currency)}</currency>`);

  if (addParams.length > 0) {
    additional = `\n  <additionalQueryParams>\n    ${addParams.join("\n    ")}\n  </additionalQueryParams>`;
  }

  return `<page>${Number(params.page)}</page>
  <invoiceDirection>${escapeXml(params.invoiceDirection)}</invoiceDirection>
  <invoiceQueryParams>
    <mandatoryQueryParams>
      ${mandatory}
    </mandatoryQueryParams>${additional}
  </invoiceQueryParams>`;
}

export function buildQueryTaxpayerBody(taxNumber: string): string {
  return `<taxNumber>${escapeXml(taxNumber)}</taxNumber>`;
}

export function buildQueryTransactionStatusBody(
  transactionId: string,
  returnOriginalRequest: boolean = false
): string {
  return `<transactionId>${escapeXml(transactionId)}</transactionId>
  <returnOriginalRequest>${Boolean(returnOriginalRequest)}</returnOriginalRequest>`;
}

export function buildQueryTransactionListBody(
  page: number,
  insDateFrom: string,
  insDateTo: string,
  requestStatus?: string
): string {
  let body = `<page>${Number(page)}</page>
  <insDateFrom>${escapeXml(insDateFrom)}</insDateFrom>
  <insDateTo>${escapeXml(insDateTo)}</insDateTo>`;
  if (requestStatus) {
    body += `\n  <requestStatus>${escapeXml(requestStatus)}</requestStatus>`;
  }
  return body;
}

export function buildQueryInvoiceChainDigestBody(
  page: number,
  invoiceNumber: string,
  invoiceDirection: string,
  taxNumber?: string
): string {
  let body = `<page>${Number(page)}</page>
  <invoiceChainQuery>
    <invoiceNumber>${escapeXml(invoiceNumber)}</invoiceNumber>
    <invoiceDirection>${escapeXml(invoiceDirection)}</invoiceDirection>`;
  if (taxNumber) {
    body += `\n    <taxNumber>${escapeXml(taxNumber)}</taxNumber>`;
  }
  body += `\n  </invoiceChainQuery>`;
  return body;
}

export function buildQueryInvoiceCheckBody(
  invoiceNumber: string,
  invoiceDirection: string,
  batchIndex?: number,
  supplierTaxNumber?: string
): string {
  let body = `<invoiceNumberQuery>
    <invoiceNumber>${escapeXml(invoiceNumber)}</invoiceNumber>
    <invoiceDirection>${escapeXml(invoiceDirection)}</invoiceDirection>`;
  if (batchIndex !== undefined) {
    body += `\n    <batchIndex>${Number(batchIndex)}</batchIndex>`;
  }
  if (supplierTaxNumber) {
    body += `\n    <supplierTaxNumber>${escapeXml(supplierTaxNumber)}</supplierTaxNumber>`;
  }
  body += `\n  </invoiceNumberQuery>`;
  return body;
}

export function buildManageInvoiceBody(
  exchangeToken: string,
  operations: Array<{
    index: number;
    operation: string;
    invoiceData: string;
    electronicInvoiceHash?: string;
  }>,
  compressed: boolean = false
): string {
  const ops = operations
    .map((op) => {
      let opXml = `<invoiceOperation>
      <index>${Number(op.index)}</index>
      <invoiceOperation>${escapeXml(op.operation)}</invoiceOperation>
      <invoiceData>${escapeXml(op.invoiceData)}</invoiceData>`;
      if (op.electronicInvoiceHash) {
        opXml += `\n      <electronicInvoiceHash cryptoType="SHA3-512">${escapeXml(op.electronicInvoiceHash)}</electronicInvoiceHash>`;
      }
      opXml += `\n    </invoiceOperation>`;
      return opXml;
    })
    .join("\n    ");

  return `<exchangeToken>${escapeXml(exchangeToken)}</exchangeToken>
  <invoiceOperations>
    <compressedContent>${Boolean(compressed)}</compressedContent>
    ${ops}
  </invoiceOperations>`;
}

export function buildManageAnnulmentBody(
  exchangeToken: string,
  operations: Array<{
    index: number;
    annulmentData: string;
  }>
): string {
  const ops = operations
    .map(
      (op) => `<annulmentOperation>
      <index>${Number(op.index)}</index>
      <annulmentOperation>ANNUL</annulmentOperation>
      <invoiceAnnulment>${escapeXml(op.annulmentData)}</invoiceAnnulment>
    </annulmentOperation>`
    )
    .join("\n    ");

  return `<exchangeToken>${escapeXml(exchangeToken)}</exchangeToken>
  <annulmentOperations>
    ${ops}
  </annulmentOperations>`;
}
