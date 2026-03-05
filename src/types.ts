export interface NavConfig {
  login: string;
  password: string;
  taxNumber: string;
  signatureKey: string;
  exchangeKey: string;
  baseUrl: string;
  softwareId: string;
  softwareName: string;
  softwareVersion: string;
  softwareDevName: string;
  softwareDevContact: string;
  softwareDevCountryCode: string;
  softwareDevTaxNumber: string;
}

export type InvoiceDirection = "INBOUND" | "OUTBOUND";
export type InvoiceOperation = "CREATE" | "MODIFY" | "STORNO";
export type QueryOperator = "EQ" | "GT" | "GTE" | "LT" | "LTE";
export type InvoiceCategory = "NORMAL" | "SIMPLIFIED" | "AGGREGATE";
export type PaymentMethod = "TRANSFER" | "CASH" | "CARD" | "VOUCHER" | "OTHER";
export type InvoiceAppearance = "PAPER" | "ELECTRONIC" | "EDI" | "UNKNOWN";
export type AnnulmentCode =
  | "ERRATIC_DATA"
  | "ERRATIC_INVOICE_NUMBER"
  | "ERRATIC_INVOICE_ISSUE_DATE"
  | "ERRATIC_ELECTRONIC_HASH_VALUE";
export type SoftwareOperation = "LOCAL_SOFTWARE" | "ONLINE_SERVICE";

export interface InvoiceNumberQuery {
  invoiceNumber: string;
  invoiceDirection: InvoiceDirection;
  batchIndex?: number;
  supplierTaxNumber?: string;
}

export interface InvoiceDigestQuery {
  page: number;
  invoiceDirection: InvoiceDirection;
  mandatoryQueryParams: {
    invoiceIssueDate?: { dateFrom: string; dateTo: string };
    insDate?: { dateTimeFrom: string; dateTimeTo: string };
    originalInvoiceNumber?: string;
  };
  additionalQueryParams?: {
    taxNumber?: string;
    groupMemberTaxNumber?: string;
    name?: string;
    invoiceCategory?: InvoiceCategory;
    paymentMethod?: PaymentMethod;
    invoiceAppearance?: InvoiceAppearance;
    source?: string;
    currency?: string;
  };
  relationalQueryParams?: {
    invoiceDelivery?: { queryOperator: QueryOperator; queryValue: string };
    paymentDate?: { queryOperator: QueryOperator; queryValue: string };
    invoiceNetAmount?: { queryOperator: QueryOperator; queryValue: number };
    invoiceNetAmountHUF?: { queryOperator: QueryOperator; queryValue: number };
    invoiceVatAmount?: { queryOperator: QueryOperator; queryValue: number };
    invoiceVatAmountHUF?: { queryOperator: QueryOperator; queryValue: number };
  };
  transactionQueryParams?: {
    transactionId?: string;
    index?: number;
    invoiceOperation?: InvoiceOperation;
  };
}

export interface TransactionListQuery {
  page: number;
  insDateFrom: string;
  insDateTo: string;
  requestStatus?: string;
}

export interface InvoiceChainQuery {
  page: number;
  invoiceNumber: string;
  invoiceDirection: InvoiceDirection;
  taxNumber?: string;
}

export interface NavApiResponse {
  funcCode: string;
  errorCode?: string;
  message?: string;
  data?: Record<string, unknown>;
  rawXml?: string;
}
