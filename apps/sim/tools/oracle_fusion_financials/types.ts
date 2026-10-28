import type { ToolResponse } from '@/tools/types'

export interface OracleFusionFinancialsActionResponse extends ToolResponse {
  output: { result: string }
}

interface OracleFusionFinancialsReceivablesInvoiceLineCreateFields {
  LineNumber?: number | null
  Description?: string | null
  ItemNumber?: string | null
  MemoLine?: string | null
  LineAmount?: number | null
  Quantity?: number | null
  UnitSellingPrice?: number | null
  UnitOfMeasure?: string | null
  AccountingRule?: string | null
  AccountingRuleDuration?: string | null
  RuleStartDate?: string | null
  RuleEndDate?: string | null
  TaxClassificationCode?: string | null
  SalesOrder?: string | null
}

interface OracleFusionFinancialsReceivablesInvoiceDistributionCreateFields {
  AccountClass?: string | null
  AccountCombination?: string | null
  AccountedAmount?: number | null
  Amount?: number | null
  InvoiceLineNumber?: number | null
  DetailedTaxLineNumber?: number | null
  Percent?: number | null
  Comments?: string | null
}

interface OracleFusionFinancialsReceivablesCreditMemoLineCreateFields {
  LineNumber: number
  LineDescription?: string | null
  ItemNumber?: string | null
  MemoLine?: string | null
  LineAmountCredit?: number | null
  LineQuantityCredit?: number | null
  UnitSellingPrice?: number | null
  UnitOfMeasure?: string | null
  LineCreditReason?: string | null
  LineFreightCreditAmount?: number | null
  TaxClassificationCode?: string | null
}

interface OracleFusionFinancialsReceivablesCreditMemoDistributionCreateFields {
  AccountClass?: string | null
  AccountCombination?: string | null
  AccountedAmount?: number | null
  Amount?: number | null
  CreditMemoLineNumber?: number | null
  DetailedTaxLineNumber?: number | null
  Percent?: number | null
  Comments?: string | null
}

interface OracleFusionFinancialsAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OracleFusionFinancialsListParams extends OracleFusionFinancialsAuthParams {
  q?: string
  finder?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionFinancialsListInvoicesParams extends OracleFusionFinancialsListParams {
  effectiveDate?: string
}

export interface OracleFusionFinancialsInvoiceParams extends OracleFusionFinancialsAuthParams {
  invoiceUniqId: string
}

export interface OracleFusionFinancialsInvoiceChildListParams
  extends OracleFusionFinancialsListParams {
  invoiceUniqId: string
}

export interface OracleFusionFinancialsInvoiceLineParams
  extends OracleFusionFinancialsInvoiceParams {
  invoiceLineUniqId: string
}

export interface OracleFusionFinancialsPaymentParams extends OracleFusionFinancialsAuthParams {
  checkId: string
}

interface OracleFusionFinancialsListEnvelope {
  items: Array<Record<string, unknown>>
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
}

export interface OracleFusionFinancialsListResponse extends ToolResponse {
  output: OracleFusionFinancialsListEnvelope
}

export interface OracleFusionFinancialsInvoiceResponse extends ToolResponse {
  output: { invoice: Record<string, unknown> }
}

export interface OracleFusionFinancialsPaymentResponse extends ToolResponse {
  output: { payment: Record<string, unknown> }
}

export type OracleFusionFinancialsDetailResponse<Wrapper extends string> = ToolResponse & {
  output: Record<Wrapper, Record<string, unknown>>
}

export type OracleFusionFinancialsListReceivablesInvoicesParams = OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetReceivablesInvoiceParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
}

export interface OracleFusionFinancialsCreateReceivablesInvoiceParams
  extends OracleFusionFinancialsAuthParams {
  lines?: OracleFusionFinancialsReceivablesInvoiceLineCreateFields[]
  distributions?: OracleFusionFinancialsReceivablesInvoiceDistributionCreateFields[]
  businessUnit?: string | null
  transactionNumber?: string | null
  transactionDate?: string | null
  accountingDate?: string | null
  billToCustomerName?: string | null
  billToCustomerNumber?: string | null
  billToSite?: string | null
  invoiceCurrencyCode?: string | null
  invoiceStatus?: string | null
  paymentTerms?: string | null
  transactionSource?: string | null
  transactionType?: string | null
  comments?: string | null
  purchaseOrder?: string | null
  conversionRateType?: string | null
  conversionRate?: number | null
  conversionDate?: string | null
}

export interface OracleFusionFinancialsUpdateReceivablesInvoiceParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  invoiceStatus?: string | null
  paymentTerms?: string | null
  transactionDate?: string | null
}

export interface OracleFusionFinancialsApproveReceivablesInvoiceParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  comment?: string
}

export interface OracleFusionFinancialsListReceivablesInvoiceLinesParams
  extends OracleFusionFinancialsListParams {
  receivablesInvoiceId: string
}

export interface OracleFusionFinancialsGetReceivablesInvoiceLineParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  receivablesInvoiceLineId: string
}

export interface OracleFusionFinancialsListReceivablesInvoiceInstallmentsParams
  extends OracleFusionFinancialsListParams {
  receivablesInvoiceId: string
}

export interface OracleFusionFinancialsGetReceivablesInvoiceInstallmentParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  receivablesInvoiceInstallmentId: string
}

export type OracleFusionFinancialsListReceivablesCreditMemosParams =
  OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetReceivablesCreditMemoParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
}

export interface OracleFusionFinancialsCreateReceivablesCreditMemoParams
  extends OracleFusionFinancialsAuthParams {
  lines?: OracleFusionFinancialsReceivablesCreditMemoLineCreateFields[]
  distributions?: OracleFusionFinancialsReceivablesCreditMemoDistributionCreateFields[]
  businessUnit: string
  transactionNumber: string
  transactionDate: string
  accountingDate?: string | null
  billToCustomerName?: string | null
  billToCustomerNumber?: string | null
  billToSite?: string | null
  creditMemoCurrency?: string | null
  creditMemoStatus?: string | null
  creditReason?: string | null
  freightCreditAmount?: string | null
  transactionSource?: string | null
  transactionType?: string | null
  creditMemoComments?: string | null
  conversionRate?: number | null
  conversionRateType?: string | null
  conversionRateDate?: string | null
}

export type OracleFusionFinancialsListReceivablesReceiptsParams = OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetReceivablesReceiptParams
  extends OracleFusionFinancialsAuthParams {
  receivablesReceiptId: string
}

export interface OracleFusionFinancialsCreateReceivablesReceiptParams
  extends OracleFusionFinancialsAuthParams {
  amount: number
  businessUnit: string
  currency: string
  receiptDate: string
  receiptMethod: string
  receiptNumber?: string | null
  accountingDate?: string | null
  customerAccountNumber?: string | null
  customerName?: string | null
  customerSite?: string | null
  comments?: string | null
  conversionRate?: number | null
  conversionRateType?: string | null
  conversionDate?: string | null
  maturityDate?: string | null
  structuredPaymentReference?: string | null
}

export interface OracleFusionFinancialsApplyReceivablesReceiptParams
  extends OracleFusionFinancialsAuthParams {
  receivablesReceiptId: string
  appliedPaymentScheduleId: string
  amountApplied?: number
  calledFrom?: string
}

export type OracleFusionFinancialsListExpenseReportsParams = OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetExpenseReportParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
}

export interface OracleFusionFinancialsCreateExpenseReportParams
  extends OracleFusionFinancialsAuthParams {
  orgId: string
  personId?: string | null
  assignmentId?: string | null
  preparerId?: string | null
  purpose?: string | null
  expenseReportNumber?: string | null
  expenseReportDate?: string | null
  reimbursementCurrencyCode?: string | null
  exchangeRateType?: string | null
  paymentMethodCode?: string | null
  overrideApproverId?: string | null
  unappliedAdvancesJust?: string | null
  unappliedCashAdvReason?: string | null
}

export interface OracleFusionFinancialsUpdateExpenseReportParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  orgId?: string
  purpose?: string | null
  expenseReportDate?: string | null
  reimbursementCurrencyCode?: string | null
  exchangeRateType?: string | null
  paymentMethodCode?: string | null
  overrideApproverId?: string | null
  unappliedAdvancesJust?: string | null
  unappliedCashAdvReason?: string | null
}

export interface OracleFusionFinancialsSubmitExpenseReportParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
}

export interface OracleFusionFinancialsListExpenseLinesParams
  extends OracleFusionFinancialsListParams {
  expenseReportUniqId: string
}

export interface OracleFusionFinancialsGetExpenseLineParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
}

export interface OracleFusionFinancialsCreateExpenseLineParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  assignmentId: string
  orgId: string
  personId: string
  ticketClass: 'BUSINESS' | 'ECONOMY'
  expenseTypeId?: string | null
  expenseTemplateId?: string | null
  description?: string | null
  justification?: string | null
  receiptAmount?: number | null
  receiptCurrencyCode?: string | null
  receiptDate?: string | null
  merchantName?: string | null
  startDate?: string | null
  endDate?: string | null
  exchangeRate?: number | null
  reimbursementCurrencyCode?: string | null
  itemizationParentExpenseId?: string | null
  receiptMissingFlag?: boolean | null
  location?: string | null
  countryCode?: string | null
  expenseCategoryCode?: string | null
  expenseSource?: string | null
  numberOfDays?: number | null
  numberOfAttendees?: number | null
  tripDistance?: number | null
  distanceUnitCode?: string | null
  ticketClassCode?: string | null
  ticketNumber?: string | null
}

export interface OracleFusionFinancialsUpdateExpenseLineParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  assignmentId?: string
  orgId?: string
  personId?: string
  ticketClass?: 'BUSINESS' | 'ECONOMY'
  expenseTypeId?: string | null
  expenseTemplateId?: string | null
  description?: string | null
  justification?: string | null
  receiptAmount?: number | null
  receiptCurrencyCode?: string | null
  receiptDate?: string | null
  merchantName?: string | null
  startDate?: string | null
  endDate?: string | null
  exchangeRate?: number | null
  reimbursementCurrencyCode?: string | null
  itemizationParentExpenseId?: string | null
  receiptMissingFlag?: boolean | null
  location?: string | null
  countryCode?: string | null
  expenseCategoryCode?: string | null
  expenseSource?: string | null
  numberOfDays?: number | null
  numberOfAttendees?: number | null
  tripDistance?: number | null
  distanceUnitCode?: string | null
  ticketClassCode?: string | null
  ticketNumber?: string | null
}

export type OracleFusionFinancialsListGlLedgersParams = OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetGlLedgerParams extends OracleFusionFinancialsAuthParams {
  glLedgerId: string
}

export type OracleFusionFinancialsListGlJournalBatchesParams = OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetGlJournalBatchParams
  extends OracleFusionFinancialsAuthParams {
  glJournalBatchId: string
}

export type OracleFusionFinancialsListGlBalancesParams = OracleFusionFinancialsListParams
