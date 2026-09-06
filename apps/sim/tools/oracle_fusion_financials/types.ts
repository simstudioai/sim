import type { ToolResponse } from '@/tools/types'

export interface OracleFusionFinancialsActionResponse extends ToolResponse {
  output: { result: string }
}

export interface OracleFusionFinancialsDeleteResponse extends ToolResponse {
  output: { deleted: boolean; id: string }
}

export interface OracleFusionFinancialsReceivablesInvoiceLineCreateFields {
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

export interface OracleFusionFinancialsReceivablesInvoiceDistributionCreateFields {
  AccountClass?: string | null
  AccountCombination?: string | null
  AccountedAmount?: number | null
  Amount?: number | null
  InvoiceLineNumber?: number | null
  DetailedTaxLineNumber?: number | null
  Percent?: number | null
  Comments?: string | null
}

export interface OracleFusionFinancialsReceivablesCreditMemoLineCreateFields {
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

export interface OracleFusionFinancialsReceivablesCreditMemoDistributionCreateFields {
  AccountClass?: string | null
  AccountCombination?: string | null
  AccountedAmount?: number | null
  Amount?: number | null
  CreditMemoLineNumber?: number | null
  DetailedTaxLineNumber?: number | null
  Percent?: number | null
  Comments?: string | null
}

export interface OracleFusionFinancialsAuthParams {
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

export interface OracleFusionFinancialsInvoiceInstallmentParams
  extends OracleFusionFinancialsInvoiceParams {
  invoiceInstallmentUniqId: string
}

export interface OracleFusionFinancialsInvoiceDistributionListParams
  extends OracleFusionFinancialsInvoiceLineParams,
    OracleFusionFinancialsListParams {}

export interface OracleFusionFinancialsInvoiceDistributionParams
  extends OracleFusionFinancialsInvoiceLineParams {
  invoiceDistributionId: string
}

export interface OracleFusionFinancialsAppliedPrepaymentParams
  extends OracleFusionFinancialsInvoiceParams {
  appliedPrepaymentUniqId: string
}

export interface OracleFusionFinancialsAvailablePrepaymentParams
  extends OracleFusionFinancialsInvoiceParams {
  availablePrepaymentUniqId: string
}

export interface OracleFusionFinancialsPaymentParams extends OracleFusionFinancialsAuthParams {
  checkId: string
}

export interface OracleFusionFinancialsPaymentRelatedInvoiceListParams
  extends OracleFusionFinancialsPaymentParams,
    OracleFusionFinancialsListParams {}

export interface OracleFusionFinancialsPaymentRelatedInvoiceParams
  extends OracleFusionFinancialsPaymentParams {
  invoicePaymentId: string
}

export interface OracleFusionFinancialsInvoiceHoldParams extends OracleFusionFinancialsAuthParams {
  holdId: string
}

export interface OracleFusionFinancialsPaymentProcessRequestParams
  extends OracleFusionFinancialsAuthParams {
  paymentProcessRequestId: string
}

export interface OracleFusionFinancialsPaymentTermParams extends OracleFusionFinancialsAuthParams {
  termsId: string
}

export interface OracleFusionFinancialsPaymentTermLineListParams
  extends OracleFusionFinancialsPaymentTermParams,
    OracleFusionFinancialsListParams {}

export interface OracleFusionFinancialsPaymentTermLineParams
  extends OracleFusionFinancialsPaymentTermParams {
  paymentTermLineUniqId: string
}

export interface OracleFusionFinancialsListEnvelope {
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

export interface OracleFusionFinancialsDeleteReceivablesInvoiceParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
}

export interface OracleFusionFinancialsApproveReceivablesInvoiceParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  comment?: string
}

export interface OracleFusionFinancialsReworkReceivablesInvoiceParams
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

export interface OracleFusionFinancialsCreateReceivablesInvoiceLineParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  lineNumber?: number | null
  description?: string | null
  itemNumber?: string | null
  memoLine?: string | null
  lineAmount?: number | null
  quantity?: number | null
  unitSellingPrice?: number | null
  unitOfMeasure?: string | null
  accountingRule?: string | null
  accountingRuleDuration?: string | null
  ruleStartDate?: string | null
  ruleEndDate?: string | null
  taxClassificationCode?: string | null
  salesOrder?: string | null
}

export interface OracleFusionFinancialsListReceivablesInvoiceDistributionsParams
  extends OracleFusionFinancialsListParams {
  receivablesInvoiceId: string
}

export interface OracleFusionFinancialsGetReceivablesInvoiceDistributionParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  receivablesInvoiceDistributionId: string
}

export interface OracleFusionFinancialsCreateReceivablesInvoiceDistributionParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  accountClass?: string | null
  accountCombination?: string | null
  accountedAmount?: number | null
  amount?: number | null
  invoiceLineNumber?: number | null
  detailedTaxLineNumber?: number | null
  percent?: number | null
  comments?: string | null
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

export interface OracleFusionFinancialsUpdateReceivablesInvoiceInstallmentParams
  extends OracleFusionFinancialsAuthParams {
  receivablesInvoiceId: string
  receivablesInvoiceInstallmentId: string
  installmentDueDate?: string
  originalAmount?: number
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

export interface OracleFusionFinancialsUpdateReceivablesCreditMemoParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
  allowCompletion?: string | null
  controlCompletionReason?: string | null
  creditMemoStatus?: string | null
  recipientEmail?: string | null
  transactionType?: string | null
}

export interface OracleFusionFinancialsApproveReceivablesCreditMemoParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
  comment?: string
}

export interface OracleFusionFinancialsReworkReceivablesCreditMemoParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
  comment?: string
}

export interface OracleFusionFinancialsListReceivablesCreditMemoLinesParams
  extends OracleFusionFinancialsListParams {
  receivablesCreditMemoId: string
}

export interface OracleFusionFinancialsGetReceivablesCreditMemoLineParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
  receivablesCreditMemoLineId: string
}

export interface OracleFusionFinancialsCreateReceivablesCreditMemoLineParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
  lineNumber: number
  lineDescription?: string | null
  itemNumber?: string | null
  memoLine?: string | null
  lineAmountCredit?: number | null
  lineQuantityCredit?: number | null
  unitSellingPrice?: number | null
  unitOfMeasure?: string | null
  lineCreditReason?: string | null
  lineFreightCreditAmount?: number | null
  taxClassificationCode?: string | null
}

export interface OracleFusionFinancialsListReceivablesCreditMemoDistributionsParams
  extends OracleFusionFinancialsListParams {
  receivablesCreditMemoId: string
}

export interface OracleFusionFinancialsGetReceivablesCreditMemoDistributionParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
  receivablesCreditMemoDistributionId: string
}

export interface OracleFusionFinancialsCreateReceivablesCreditMemoDistributionParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCreditMemoId: string
  accountClass?: string | null
  accountCombination?: string | null
  accountedAmount?: number | null
  amount?: number | null
  creditMemoLineNumber?: number | null
  detailedTaxLineNumber?: number | null
  percent?: number | null
  comments?: string | null
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

export interface OracleFusionFinancialsUpdateReceivablesReceiptParams
  extends OracleFusionFinancialsAuthParams {
  receivablesReceiptId: string
  amount?: number
  currency?: string
  receiptDate?: string
  receiptMethod?: string
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

export interface OracleFusionFinancialsDeleteReceivablesReceiptParams
  extends OracleFusionFinancialsAuthParams {
  receivablesReceiptId: string
}

export interface OracleFusionFinancialsApplyReceivablesReceiptParams
  extends OracleFusionFinancialsAuthParams {
  receivablesReceiptId: string
  appliedPaymentScheduleId: string
  amountApplied?: number
  calledFrom?: string
}

export type OracleFusionFinancialsListReceivablesCustomerAccountsParams =
  OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetReceivablesCustomerAccountParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCustomerAccountId: string
}

export type OracleFusionFinancialsListReceivablesCustomerAccountSitesParams =
  OracleFusionFinancialsListParams

export interface OracleFusionFinancialsGetReceivablesCustomerAccountSiteParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCustomerAccountSiteId: string
}

export interface OracleFusionFinancialsListReceivablesReceiptApplicationsParams
  extends OracleFusionFinancialsListParams {
  receivablesCustomerAccountId: string
}

export interface OracleFusionFinancialsGetReceivablesReceiptApplicationParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCustomerAccountId: string
  receivablesReceiptApplicationId: string
}

export interface OracleFusionFinancialsListReceivablesCreditMemoApplicationsParams
  extends OracleFusionFinancialsListParams {
  receivablesCustomerAccountId: string
}

export interface OracleFusionFinancialsGetReceivablesCreditMemoApplicationParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCustomerAccountId: string
  receivablesCreditMemoApplicationId: string
}

export interface OracleFusionFinancialsListReceivablesTransactionPaymentSchedulesParams
  extends OracleFusionFinancialsListParams {
  receivablesCustomerAccountId: string
}

export interface OracleFusionFinancialsGetReceivablesTransactionPaymentScheduleParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCustomerAccountId: string
  receivablesTransactionPaymentScheduleId: string
}

export interface OracleFusionFinancialsListReceivablesTransactionAdjustmentsParams
  extends OracleFusionFinancialsListParams {
  receivablesCustomerAccountId: string
}

export interface OracleFusionFinancialsGetReceivablesTransactionAdjustmentParams
  extends OracleFusionFinancialsAuthParams {
  receivablesCustomerAccountId: string
  receivablesTransactionAdjustmentId: string
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

export interface OracleFusionFinancialsRemoveExpenseReportCashAdvanceParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  cashAdvanceNumber: string
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
  ticketClass: string
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
  ticketClass?: string
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

export interface OracleFusionFinancialsListExpenseDistributionsParams
  extends OracleFusionFinancialsListParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
}

export interface OracleFusionFinancialsGetExpenseDistributionParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  expenseDistributionId: string
}

export interface OracleFusionFinancialsCreateExpenseDistributionParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  expenseId: string
  orgId: string
  codeCombinationId?: string | null
  company?: string | null
  costCenter?: string | null
  reimbursableAmount?: number | null
}

export interface OracleFusionFinancialsUpdateExpenseDistributionParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  expenseDistributionId: string
  expenseId: string
  orgId: string
  codeCombinationId?: string | null
  company?: string | null
  costCenter?: string | null
  reimbursableAmount?: number | null
}

export interface OracleFusionFinancialsListExpenseItemizationsParams
  extends OracleFusionFinancialsListParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
}

export interface OracleFusionFinancialsGetExpenseItemizationParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  expenseItemizationId: string
}

export interface OracleFusionFinancialsCreateExpenseItemizationParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  assignmentId?: string
  orgId?: string
  personId?: string
  expenseTypeId?: string | null
  expenseTemplateId?: string | null
  itemizationParentExpenseId?: string | null
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
  receiptMissingFlag?: boolean | null
  location?: string | null
  expenseCategoryCode?: string | null
  numberOfDays?: number | null
  numberOfAttendees?: number | null
}

export interface OracleFusionFinancialsUpdateExpenseItemizationParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  expenseItemizationId: string
  assignmentId?: string
  orgId?: string
  personId?: string
  expenseTypeId?: string | null
  expenseTemplateId?: string | null
  itemizationParentExpenseId?: string | null
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
  receiptMissingFlag?: boolean | null
  location?: string | null
  expenseCategoryCode?: string | null
  numberOfDays?: number | null
  numberOfAttendees?: number | null
}

export interface OracleFusionFinancialsListExpenseReportProcessingDetailsParams
  extends OracleFusionFinancialsListParams {
  expenseReportUniqId: string
}

export interface OracleFusionFinancialsGetExpenseReportProcessingDetailParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseReportProcessingDetailUniqId: string
}

export interface OracleFusionFinancialsListExpenseReportPaymentsParams
  extends OracleFusionFinancialsListParams {
  expenseReportUniqId: string
}

export interface OracleFusionFinancialsGetExpenseReportPaymentParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseReportPaymentId: string
}

export interface OracleFusionFinancialsListExpenseLineErrorsParams
  extends OracleFusionFinancialsListParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
}

export interface OracleFusionFinancialsGetExpenseLineErrorParams
  extends OracleFusionFinancialsAuthParams {
  expenseReportUniqId: string
  expenseLineUniqId: string
  expenseLineErrorSequence: string
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

export interface OracleFusionFinancialsDeleteGlJournalBatchParams
  extends OracleFusionFinancialsAuthParams {
  glJournalBatchId: string
}

export interface OracleFusionFinancialsListGlJournalHeadersParams
  extends OracleFusionFinancialsListParams {
  glJournalBatchId: string
}

export interface OracleFusionFinancialsGetGlJournalHeaderParams
  extends OracleFusionFinancialsAuthParams {
  glJournalBatchId: string
  glJournalHeaderUniqId: string
}

export interface OracleFusionFinancialsListGlJournalLinesParams
  extends OracleFusionFinancialsListParams {
  glJournalBatchId: string
  glJournalHeaderUniqId: string
}

export interface OracleFusionFinancialsGetGlJournalLineParams
  extends OracleFusionFinancialsAuthParams {
  glJournalBatchId: string
  glJournalHeaderUniqId: string
  glJournalLineUniqId: string
}

export interface OracleFusionFinancialsListGlJournalErrorsParams
  extends OracleFusionFinancialsListParams {
  glJournalBatchId: string
}

export interface OracleFusionFinancialsGetGlJournalErrorParams
  extends OracleFusionFinancialsAuthParams {
  glJournalBatchId: string
  glJournalErrorUniqId: string
}

export interface OracleFusionFinancialsListGlJournalActionLogsParams
  extends OracleFusionFinancialsListParams {
  glJournalBatchId: string
}

export interface OracleFusionFinancialsGetGlJournalActionLogParams
  extends OracleFusionFinancialsAuthParams {
  glJournalBatchId: string
  glJournalActionLogUniqId: string
}

export type OracleFusionFinancialsListGlBalancesParams = OracleFusionFinancialsListParams
