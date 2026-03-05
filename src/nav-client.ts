import type { NavConfig } from "./types.js";
import {
  buildRequest,
  buildTokenExchangeBody,
  buildQueryInvoiceDataBody,
  buildQueryInvoiceDigestBody,
  buildQueryTaxpayerBody,
  buildQueryTransactionStatusBody,
  buildQueryTransactionListBody,
  buildQueryInvoiceChainDigestBody,
  buildQueryInvoiceCheckBody,
  buildManageInvoiceBody,
  buildManageAnnulmentBody,
} from "./xml-builder.js";
import { parseXmlResponse, extractResult, extractResponseData } from "./xml-parser.js";
import { decryptExchangeToken, computeInvoiceHash } from "./crypto.js";

export class NavClient {
  private config: NavConfig;

  constructor(config: NavConfig) {
    this.config = config;
  }

  private async sendRequest(
    endpoint: string,
    xml: string
  ): Promise<{ parsed: Record<string, unknown>; rawXml: string }> {
    const url = `${this.config.baseUrl}/${endpoint}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/xml", Accept: "application/xml" },
      body: xml,
    });

    const rawXml = await response.text();
    const parsed = parseXmlResponse(rawXml);
    return { parsed, rawXml };
  }

  async tokenExchange(): Promise<{ token: string; validFrom: string; validTo: string }> {
    const body = buildTokenExchangeBody();
    const { xml } = buildRequest("TokenExchange", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("tokenExchange", xml);

    const result = extractResult(parsed);
    if (result.funcCode !== "OK") {
      throw new Error(
        `tokenExchange failed: ${result.errorCode || ""} ${result.message || rawXml}`
      );
    }

    const data = extractResponseData(parsed);
    if (!data) throw new Error("No response data from tokenExchange");

    const encodedToken = data.encodedExchangeToken as string;
    const token = decryptExchangeToken(encodedToken, this.config.exchangeKey);

    return {
      token,
      validFrom: data.tokenValidityFrom as string,
      validTo: data.tokenValidityTo as string,
    };
  }

  async queryInvoiceData(
    invoiceNumber: string,
    invoiceDirection: string,
    batchIndex?: number,
    supplierTaxNumber?: string
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string }> {
    const body = buildQueryInvoiceDataBody(invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber);
    const { xml } = buildRequest("QueryInvoiceData", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("queryInvoiceData", xml);

    return {
      result: extractResult(parsed),
      data: extractResponseData(parsed),
      rawXml,
    };
  }

  async queryInvoiceDigest(params: {
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
  }): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string }> {
    const body = buildQueryInvoiceDigestBody(params);
    const { xml } = buildRequest("QueryInvoiceDigest", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("queryInvoiceDigest", xml);

    return {
      result: extractResult(parsed),
      data: extractResponseData(parsed),
      rawXml,
    };
  }

  async queryTaxpayer(
    taxNumber: string
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string }> {
    const body = buildQueryTaxpayerBody(taxNumber);
    const { xml } = buildRequest("QueryTaxpayer", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("queryTaxpayer", xml);

    return {
      result: extractResult(parsed),
      data: extractResponseData(parsed),
      rawXml,
    };
  }

  async queryTransactionStatus(
    transactionId: string,
    returnOriginalRequest: boolean = false
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string }> {
    const body = buildQueryTransactionStatusBody(transactionId, returnOriginalRequest);
    const { xml } = buildRequest("QueryTransactionStatus", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("queryTransactionStatus", xml);

    return {
      result: extractResult(parsed),
      data: extractResponseData(parsed),
      rawXml,
    };
  }

  async queryTransactionList(
    page: number,
    insDateFrom: string,
    insDateTo: string,
    requestStatus?: string
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string }> {
    const body = buildQueryTransactionListBody(page, insDateFrom, insDateTo, requestStatus);
    const { xml } = buildRequest("QueryTransactionList", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("queryTransactionList", xml);

    return {
      result: extractResult(parsed),
      data: extractResponseData(parsed),
      rawXml,
    };
  }

  async queryInvoiceChainDigest(
    page: number,
    invoiceNumber: string,
    invoiceDirection: string,
    taxNumber?: string
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string }> {
    const body = buildQueryInvoiceChainDigestBody(page, invoiceNumber, invoiceDirection, taxNumber);
    const { xml } = buildRequest("QueryInvoiceChainDigest", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("queryInvoiceChainDigest", xml);

    return {
      result: extractResult(parsed),
      data: extractResponseData(parsed),
      rawXml,
    };
  }

  async queryInvoiceCheck(
    invoiceNumber: string,
    invoiceDirection: string,
    batchIndex?: number,
    supplierTaxNumber?: string
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string }> {
    const body = buildQueryInvoiceCheckBody(invoiceNumber, invoiceDirection, batchIndex, supplierTaxNumber);
    const { xml } = buildRequest("QueryInvoiceCheck", this.config, body);
    const { parsed, rawXml } = await this.sendRequest("queryInvoiceCheck", xml);

    return {
      result: extractResult(parsed),
      data: extractResponseData(parsed),
      rawXml,
    };
  }

  async manageInvoice(
    operations: Array<{
      index: number;
      operation: string;
      invoiceData: string;
      electronicInvoiceHash?: string;
    }>,
    compressed: boolean = false
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string; transactionId?: string }> {
    // Step 1: Get exchange token
    const { token } = await this.tokenExchange();

    // Step 2: Compute invoice hashes for signature
    const invoiceHashes = operations.map((op) =>
      computeInvoiceHash(op.operation, op.invoiceData)
    );

    // Step 3: Build request with invoice hashes in signature
    const body = buildManageInvoiceBody(token, operations, compressed);
    const { xml } = buildRequest("ManageInvoice", this.config, body, invoiceHashes);
    const { parsed, rawXml } = await this.sendRequest("manageInvoice", xml);

    const data = extractResponseData(parsed);
    const transactionId = data?.transactionId as string | undefined;

    return {
      result: extractResult(parsed),
      data,
      rawXml,
      transactionId,
    };
  }

  async manageAnnulment(
    operations: Array<{
      index: number;
      annulmentData: string;
    }>
  ): Promise<{ result: ReturnType<typeof extractResult>; data: Record<string, unknown> | undefined; rawXml: string; transactionId?: string }> {
    // Step 1: Get exchange token
    const { token } = await this.tokenExchange();

    // Step 2: Compute hashes for signature
    const invoiceHashes = operations.map((op) =>
      computeInvoiceHash("ANNUL", op.annulmentData)
    );

    // Step 3: Build request
    const body = buildManageAnnulmentBody(token, operations);
    const { xml } = buildRequest("ManageAnnulment", this.config, body, invoiceHashes);
    const { parsed, rawXml } = await this.sendRequest("manageAnnulment", xml);

    const data = extractResponseData(parsed);
    const transactionId = data?.transactionId as string | undefined;

    return {
      result: extractResult(parsed),
      data,
      rawXml,
      transactionId,
    };
  }
}
