import type { ToolFileData, ToolResponse } from '@/tools/types'

export const QUICKBOOKS_QUERYABLE_ENTITIES = [
  'Account',
  'Attachable',
  'Bill',
  'BillPayment',
  'Budget',
  'Class',
  'CompanyCurrency',
  'CreditMemo',
  'Customer',
  'Department',
  'Deposit',
  'Employee',
  'Estimate',
  'Invoice',
  'InventoryAdjustment',
  'Item',
  'JournalEntry',
  'Payment',
  'PaymentMethod',
  'Purchase',
  'PurchaseOrder',
  'RefundReceipt',
  'SalesReceipt',
  'TaxAgency',
  'TaxCode',
  'TaxRate',
  'Term',
  'TimeActivity',
  'Transfer',
  'Vendor',
  'VendorCredit',
] as const

export const QUICKBOOKS_READABLE_ENTITIES = [
  'Account',
  'Attachable',
  'Bill',
  'BillPayment',
  'Class',
  'CompanyCurrency',
  'CompanyInfo',
  'CreditMemo',
  'Customer',
  'Department',
  'Deposit',
  'Employee',
  'Estimate',
  'Invoice',
  'InventoryAdjustment',
  'Item',
  'JournalEntry',
  'Payment',
  'PaymentMethod',
  'Purchase',
  'PurchaseOrder',
  'RefundReceipt',
  'SalesReceipt',
  'TaxAgency',
  'TaxCode',
  'TaxRate',
  'Term',
  'TimeActivity',
  'Transfer',
  'Vendor',
  'VendorCredit',
] as const

export const QUICKBOOKS_CREATABLE_ENTITIES = [
  'Account',
  'Attachable',
  'Bill',
  'BillPayment',
  'Class',
  'CompanyCurrency',
  'CreditMemo',
  'Customer',
  'Department',
  'Deposit',
  'Employee',
  'Estimate',
  'Invoice',
  'InventoryAdjustment',
  'Item',
  'JournalEntry',
  'Payment',
  'PaymentMethod',
  'Purchase',
  'PurchaseOrder',
  'RefundReceipt',
  'SalesReceipt',
  'Term',
  'TimeActivity',
  'Transfer',
  'Vendor',
  'VendorCredit',
] as const

export const QUICKBOOKS_UPDATABLE_ENTITIES = [
  ...QUICKBOOKS_CREATABLE_ENTITIES,
  'CompanyInfo',
] as const

export const QUICKBOOKS_SIMPLIFIED_DELETE_ENTITIES = [
  'Bill',
  'BillPayment',
  'CreditMemo',
  'Estimate',
  'Invoice',
  'JournalEntry',
  'Payment',
  'Purchase',
  'PurchaseOrder',
  'RefundReceipt',
  'SalesReceipt',
  'TimeActivity',
  'VendorCredit',
] as const

export const QUICKBOOKS_FULL_DELETE_ENTITIES = [
  'Attachable',
  'Deposit',
  'InventoryAdjustment',
  'Transfer',
] as const

export const QUICKBOOKS_DELETABLE_ENTITIES = [
  ...QUICKBOOKS_SIMPLIFIED_DELETE_ENTITIES,
  ...QUICKBOOKS_FULL_DELETE_ENTITIES,
] as const

export const QUICKBOOKS_CDC_ENTITIES = QUICKBOOKS_READABLE_ENTITIES.filter(
  (entity) => !['TaxAgency', 'TaxCode', 'TaxRate', 'TimeActivity'].includes(entity)
) as Exclude<
  (typeof QUICKBOOKS_READABLE_ENTITIES)[number],
  'TaxAgency' | 'TaxCode' | 'TaxRate' | 'TimeActivity'
>[]

export const QUICKBOOKS_REPORTS = [
  'AccountListDetail',
  'AgedPayableDetail',
  'AgedPayables',
  'AgedReceivableDetail',
  'AgedReceivables',
  'BalanceSheet',
  'CashFlow',
  'ClassSales',
  'CustomerBalance',
  'CustomerBalanceDetail',
  'CustomerIncome',
  'CustomerSales',
  'DepartmentSales',
  'GeneralLedgerDetail',
  'InventoryValuationDetail',
  'InventoryValuationSummary',
  'ItemSales',
  'ProfitAndLoss',
  'ProfitAndLossDetail',
  'TaxSummary',
  'TrialBalance',
  'VendorBalance',
  'VendorBalanceDetail',
  'VendorExpenses',
] as const

export const QUICKBOOKS_PDF_ENTITIES = [
  'CreditMemo',
  'Estimate',
  'Invoice',
  'Payment',
  'PurchaseOrder',
  'RefundReceipt',
  'SalesReceipt',
] as const

export const QUICKBOOKS_SENDABLE_ENTITIES = QUICKBOOKS_PDF_ENTITIES

export type QuickBooksEntityName = (typeof QUICKBOOKS_QUERYABLE_ENTITIES)[number] | 'CompanyInfo'
export type QuickBooksReportName = (typeof QUICKBOOKS_REPORTS)[number]
export type QuickBooksPdfEntityName = (typeof QUICKBOOKS_PDF_ENTITIES)[number]
export type QuickBooksSendableEntityName = (typeof QUICKBOOKS_SENDABLE_ENTITIES)[number]
export type QuickBooksEnvironment = 'production' | 'sandbox'

export interface QuickBooksBaseParams {
  accessToken: string
  realmId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}

export interface QuickBooksListParams extends QuickBooksBaseParams {
  startPosition?: string
  maxResults?: string
  activeOnly?: boolean | string
}

export interface QuickBooksListRecordsParams extends QuickBooksListParams {
  entity: QuickBooksEntityName | string
  whereClause?: string
  orderBy?: string
}

export interface QuickBooksQueryParams extends QuickBooksBaseParams {
  query: string
}

export interface QuickBooksGetRecordParams extends QuickBooksBaseParams {
  entity: QuickBooksEntityName | string
  recordId: string
}

export interface QuickBooksCreateRecordParams extends QuickBooksBaseParams {
  entity: QuickBooksEntityName | string
  payload: QuickBooksRecord | string
}

export interface QuickBooksUpdateRecordParams extends QuickBooksCreateRecordParams {
  recordId: string
  syncToken: string
  sparse?: boolean | string
}

export interface QuickBooksDeleteRecordParams extends QuickBooksBaseParams {
  entity: QuickBooksEntityName | string
  recordId: string
  syncToken: string
  payload?: QuickBooksRecord | string
}

export interface QuickBooksReportParams extends QuickBooksBaseParams {
  report: QuickBooksReportName | string
  reportParams?: QuickBooksRecord | string
}

export interface QuickBooksCdcParams extends QuickBooksBaseParams {
  entities: QuickBooksEntityName[] | string
  changedSince: string
}

export interface QuickBooksBatchParams extends QuickBooksBaseParams {
  batch: QuickBooksRecord | string
}

export interface QuickBooksPreferencesParams extends QuickBooksBaseParams {}

export interface QuickBooksUpdatePreferencesParams extends QuickBooksBaseParams {
  payload: QuickBooksRecord | string
}

export interface QuickBooksExchangeRateParams extends QuickBooksBaseParams {
  sourceCurrencyCode?: string
  asOfDate?: string
  payload?: QuickBooksRecord | string
}

export interface QuickBooksDownloadDocumentParams extends QuickBooksBaseParams {
  entity: QuickBooksPdfEntityName | string
  recordId: string
}

export interface QuickBooksSendDocumentParams extends QuickBooksBaseParams {
  entity: QuickBooksSendableEntityName | string
  recordId: string
  sendTo?: string
}

export interface QuickBooksAttachmentUrlParams extends QuickBooksBaseParams {
  attachmentId: string
  thumbnail?: boolean | string
}

export interface QuickBooksUploadAttachmentParams extends QuickBooksBaseParams {
  file: unknown
  entity: string
  entityId: string
  note?: string
  includeOnSend?: boolean | string
}

export type QuickBooksRecord = Record<string, unknown>

export interface QuickBooksFault {
  Error?: Array<{
    Message?: string
    Detail?: string
    code?: string
  }>
}

export interface QuickBooksApiEnvelope extends QuickBooksRecord {
  QueryResponse?: Record<string, unknown> & {
    Fault?: QuickBooksFault
  }
  BatchItemResponse?: QuickBooksRecord[]
  CDCResponse?: Array<{
    QueryResponse?: QuickBooksRecord[]
  }>
  Header?: QuickBooksRecord
  Columns?: QuickBooksRecord
  Rows?: QuickBooksRecord
  Preferences?: QuickBooksRecord
  ExchangeRate?: QuickBooksRecord
  Fault?: QuickBooksFault
  time?: string
}

export interface QuickBooksQueryOutput {
  items: QuickBooksRecord[]
  entity: string | null
  totalCount: number | null
  startPosition: number | null
  maxResults: number | null
  query: string
}

export interface QuickBooksQueryResponse extends ToolResponse {
  output: QuickBooksQueryOutput
}

export interface QuickBooksRecordOutput {
  record: QuickBooksRecord | null
  entity: string
  time: string | null
}

export interface QuickBooksRecordResponse extends ToolResponse {
  output: QuickBooksRecordOutput
}

export interface QuickBooksReportOutput {
  report: string
  header: QuickBooksRecord
  columns: QuickBooksRecord
  rows: QuickBooksRecord
  time: string | null
}

export interface QuickBooksReportResponse extends ToolResponse {
  output: QuickBooksReportOutput
}

export interface QuickBooksCdcOutput {
  changes: QuickBooksRecord[]
  changedSince: string
  mayBeTruncated: boolean
  time: string | null
}

export interface QuickBooksCdcResponse extends ToolResponse {
  output: QuickBooksCdcOutput
}

export interface QuickBooksBatchOutput {
  batchItems: QuickBooksRecord[]
  time: string | null
}

export interface QuickBooksBatchResponse extends ToolResponse {
  output: QuickBooksBatchOutput
}

export interface QuickBooksAttachmentUrlResponse extends ToolResponse {
  output: {
    url: string
    attachmentId: string
    thumbnail: boolean
  }
}

export interface QuickBooksFileResponse extends ToolResponse {
  output: {
    file: ToolFileData
    entity: string
    recordId: string
  }
}

export interface QuickBooksUploadAttachmentResponse extends ToolResponse {
  output: {
    result: QuickBooksRecord
  }
}

export type QuickBooksResponse =
  | QuickBooksQueryResponse
  | QuickBooksRecordResponse
  | QuickBooksReportResponse
  | QuickBooksCdcResponse
  | QuickBooksBatchResponse
  | QuickBooksAttachmentUrlResponse
  | QuickBooksFileResponse
  | QuickBooksUploadAttachmentResponse
