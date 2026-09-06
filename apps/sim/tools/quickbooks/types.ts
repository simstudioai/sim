import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import type { UserFile } from '@/executor/types'
import type { QuickBooksEnvironment } from '@/tools/quickbooks/client'
import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface QuickBooksReference {
  value?: string
  name?: string
}

export interface QuickBooksAddress {
  Id?: string
  Line1?: string
  Line2?: string
  Line3?: string
  Line4?: string
  Line5?: string
  City?: string
  Country?: string
  CountrySubDivisionCode?: string
  PostalCode?: string
  Lat?: string
  Long?: string
}

export interface QuickBooksEmailAddress {
  Address?: string
}

export interface QuickBooksPhoneNumber {
  FreeFormNumber?: string
}

export interface QuickBooksMetaData {
  CreateTime?: string
  LastUpdatedTime?: string
}

export interface QuickBooksAccount {
  Id: string
  SyncToken?: string
  Name?: string
  SubAccount?: boolean
  ParentRef?: QuickBooksReference
  FullyQualifiedName?: string
  Active?: boolean
  Classification?: string
  AccountType?: string
  AccountSubType?: string
  CurrentBalance?: number
  CurrentBalanceWithSubAccounts?: number
  CurrencyRef?: QuickBooksReference
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksClass {
  Id: string
  SyncToken?: string
  Name?: string
  SubClass?: boolean
  ParentRef?: QuickBooksReference
  FullyQualifiedName?: string
  Active?: boolean
  MetaData?: QuickBooksMetaData
  domain?: string
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksDepartment {
  Id: string
  SyncToken?: string
  Name?: string
  SubDepartment?: boolean
  ParentRef?: QuickBooksReference
  FullyQualifiedName?: string
  Active?: boolean
  MetaData?: QuickBooksMetaData
  domain?: string
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksCustomer {
  Id: string
  SyncToken?: string
  DisplayName?: string
  CompanyName?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  Title?: string
  PrintOnCheckName?: string
  Active?: boolean
  Taxable?: boolean
  BillAddr?: QuickBooksAddress
  ShipAddr?: QuickBooksAddress
  PrimaryPhone?: QuickBooksPhoneNumber
  Mobile?: QuickBooksPhoneNumber
  Fax?: QuickBooksPhoneNumber
  AlternatePhone?: QuickBooksPhoneNumber
  PrimaryEmailAddr?: QuickBooksEmailAddress
  WebAddr?: { URI?: string }
  Balance?: number
  BalanceWithJobs?: number
  CurrencyRef?: QuickBooksReference
  ParentRef?: QuickBooksReference
  Job?: boolean
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksEmployee {
  Id: string
  SyncToken?: string
  DisplayName?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  Title?: string
  PrintOnCheckName?: string
  Active?: boolean
  PrimaryPhone?: QuickBooksPhoneNumber
  Mobile?: QuickBooksPhoneNumber
  PrimaryEmailAddr?: QuickBooksEmailAddress
  PrimaryAddr?: QuickBooksAddress
  BillableTime?: boolean
  MetaData?: QuickBooksMetaData
  domain?: string
  sparse?: boolean
}

export interface QuickBooksItem {
  Id: string
  SyncToken?: string
  Name?: string
  Description?: string
  Active?: boolean
  FullyQualifiedName?: string
  Taxable?: boolean
  UnitPrice?: number
  Type?: string
  IncomeAccountRef?: QuickBooksReference
  PurchaseDesc?: string
  PurchaseCost?: number
  ExpenseAccountRef?: QuickBooksReference
  AssetAccountRef?: QuickBooksReference
  TrackQtyOnHand?: boolean
  QtyOnHand?: number
  InvStartDate?: string
  ParentRef?: QuickBooksReference
  SubItem?: boolean
  Level?: number
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksCompanyInfo {
  Id: string
  SyncToken?: string
  CompanyName?: string
  LegalName?: string
  CompanyAddr?: QuickBooksAddress
  CustomerCommunicationAddr?: QuickBooksAddress
  LegalAddr?: QuickBooksAddress
  PrimaryPhone?: QuickBooksPhoneNumber
  Email?: QuickBooksEmailAddress
  WebAddr?: { URI?: string }
  CompanyStartDate?: string
  Country?: string
  FiscalYearStartMonth?: string
  SupportedLanguages?: string
  EmployerId?: string
  domain?: string
  sparse?: boolean
  NameValue?: Array<{ Name?: string; Value?: string }>
  MetaData?: QuickBooksMetaData
  [key: string]: unknown
}

export interface QuickBooksVendor {
  Id: string
  SyncToken?: string
  DisplayName?: string
  CompanyName?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  Title?: string
  PrintOnCheckName?: string
  Active?: boolean
  Vendor1099?: boolean
  BillAddr?: QuickBooksAddress
  PrimaryPhone?: QuickBooksPhoneNumber
  Mobile?: QuickBooksPhoneNumber
  Fax?: QuickBooksPhoneNumber
  AlternatePhone?: QuickBooksPhoneNumber
  PrimaryEmailAddr?: QuickBooksEmailAddress
  WebAddr?: { URI?: string }
  Balance?: number
  CurrencyRef?: QuickBooksReference
  AcctNum?: string
  TermRef?: QuickBooksReference
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksLinkedTransaction {
  TxnId?: string
  TxnType?: string
  TxnLineId?: string
  [key: string]: unknown
}

export interface QuickBooksTransactionLine {
  Id?: string
  LineNum?: number
  Description?: string
  Amount?: number
  DetailType?: string
  LinkedTxn?: QuickBooksLinkedTransaction[]
  AccountBasedExpenseLineDetail?: Record<string, unknown>
  ItemBasedExpenseLineDetail?: Record<string, unknown>
  [key: string]: unknown
}

export interface QuickBooksTransaction {
  Id: string
  SyncToken?: string
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  ExpirationDate?: string
  CustomerRef?: QuickBooksReference
  CustomerMemo?: { value?: string }
  VendorRef?: QuickBooksReference
  APAccountRef?: QuickBooksReference
  AccountRef?: QuickBooksReference
  FromAccountRef?: QuickBooksReference
  ToAccountRef?: QuickBooksReference
  EntityRef?: QuickBooksReference & { type?: string }
  DepositToAccountRef?: QuickBooksReference
  PaymentMethodRef?: QuickBooksReference
  PaymentRefNum?: string
  PaymentType?: string
  PayType?: string
  CheckPayment?: { BankAccountRef?: QuickBooksReference; [key: string]: unknown }
  CreditCardPayment?: { CCAccountRef?: QuickBooksReference; [key: string]: unknown }
  CurrencyRef?: QuickBooksReference
  ExchangeRate?: number
  Line?: QuickBooksTransactionLine[]
  LinkedTxn?: QuickBooksLinkedTransaction[]
  Amount?: number
  TotalAmt?: number
  Balance?: number
  UnappliedAmt?: number
  PrivateNote?: string
  Adjustment?: boolean
  TxnStatus?: string
  TxnTaxDetail?: Record<string, unknown>
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export type QuickBooksPurchaseOrder = QuickBooksTransaction
export type QuickBooksBill = QuickBooksTransaction
export type QuickBooksSalesTransaction = QuickBooksTransaction
export type QuickBooksPurchasingTransaction = QuickBooksTransaction
export type QuickBooksAccountingTransaction = QuickBooksTransaction

export interface QuickBooksAuthParams {
  accessToken: string
  realmId: string
  quickBooksEnvironment: QuickBooksEnvironment
}

export type QuickBooksMasterDataRecordType =
  | 'account'
  | 'class'
  | 'customer'
  | 'department'
  | 'employee'
  | 'item'
  | 'vendor'

export type QuickBooksMasterDataReadMode = 'list' | 'by_id'

export type QuickBooksMasterDataRecord =
  | QuickBooksAccount
  | QuickBooksClass
  | QuickBooksCustomer
  | QuickBooksDepartment
  | QuickBooksVendor
  | QuickBooksItem
  | QuickBooksEmployee

export interface QuickBooksPaginationParams extends QuickBooksAuthParams {
  startPosition: number
  maxResults: number
}

export interface QuickBooksReadMasterDataParams extends QuickBooksAuthParams {
  recordType: QuickBooksMasterDataRecordType
  readMode: QuickBooksMasterDataReadMode
  recordId?: string
  startPosition?: number
  maxResults?: number
  activeStatus?: QuickBooksReadActiveStatus
}

export type QuickBooksSalesTransactionType =
  | 'estimate'
  | 'invoice'
  | 'sales_receipt'
  | 'payment'
  | 'credit_memo'
  | 'refund_receipt'

export interface QuickBooksReadSalesTransactionsParams extends QuickBooksAuthParams {
  transactionType: QuickBooksSalesTransactionType
  readMode: QuickBooksMasterDataReadMode
  transactionId?: string
  startPosition?: number
  maxResults?: number
  startDate?: string
  endDate?: string
  customerId?: string
}

export type QuickBooksPurchasingTransactionType =
  | 'purchase_order'
  | 'bill'
  | 'bill_payment'
  | 'vendor_credit'
  | 'purchase'

export interface QuickBooksReadPurchasingTransactionsParams extends QuickBooksAuthParams {
  transactionType: QuickBooksPurchasingTransactionType
  readMode: QuickBooksMasterDataReadMode
  transactionId?: string
  startPosition?: number
  maxResults?: number
  startDate?: string
  endDate?: string
  vendorId?: string
}

export type QuickBooksAccountingTransactionType = 'journal_entry' | 'deposit' | 'transfer'

export interface QuickBooksReadAccountingTransactionsParams extends QuickBooksAuthParams {
  transactionType: QuickBooksAccountingTransactionType
  readMode: QuickBooksMasterDataReadMode
  transactionId?: string
  startPosition?: number
  maxResults?: number
  startDate?: string
  endDate?: string
}

/**
 * Every report Sim exposes, one per documented `GET /v3/company/<realmID>/reports/<name>`
 * operation in Intuit's report catalog. `trial_balance_fr` is the France-locale sibling of
 * `trial_balance`: Intuit documents the operation as "FR locale - .../reports/TrialBalanceFR,
 * non-FR locales - .../reports/TrialBalance", so the endpoint is a caller choice rather than
 * something Sim can derive from the realm ID.
 */
export type QuickBooksReportType =
  | 'account_list_detail'
  | 'balance_sheet'
  | 'profit_and_loss'
  | 'profit_and_loss_detail'
  | 'trial_balance'
  | 'trial_balance_fr'
  | 'cash_flow'
  | 'ap_aging_summary'
  | 'ap_aging_detail'
  | 'ar_aging_summary'
  | 'ar_aging_detail'
  | 'vendor_balance'
  | 'vendor_balance_detail'
  | 'customer_balance'
  | 'customer_balance_detail'
  | 'customer_income'
  | 'sales_by_customer'
  | 'sales_by_item'
  | 'sales_by_class'
  | 'sales_by_department'
  | 'expenses_by_vendor'
  | 'general_ledger_detail'
  | 'inventory_valuation_summary'
  | 'inventory_valuation_detail'
  | 'tax_summary'
  | 'transaction_list'

export type QuickBooksAccountingMethod = 'default' | 'cash' | 'accrual'

/**
 * Predefined report date ranges. These 23 values are the set every date-macro-capable report
 * model in Intuit's report catalog documents. The Transaction List family additionally accepts
 * ten calendar-based macros ("This Calendar Year", ...); Sim sends only the shared set so one
 * value is valid on every report that advertises `date_macro`.
 */
export type QuickBooksReportDateMacro =
  | 'default'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_week_to_date'
  | 'last_week_to_date'
  | 'next_week'
  | 'next_4_weeks'
  | 'this_month'
  | 'last_month'
  | 'this_month_to_date'
  | 'last_month_to_date'
  | 'next_month'
  | 'this_fiscal_quarter'
  | 'last_fiscal_quarter'
  | 'this_fiscal_quarter_to_date'
  | 'last_fiscal_quarter_to_date'
  | 'next_fiscal_quarter'
  | 'this_fiscal_year'
  | 'last_fiscal_year'
  | 'this_fiscal_year_to_date'
  | 'last_fiscal_year_to_date'
  | 'next_fiscal_year'

export type QuickBooksReportSummarizeBy =
  | 'default'
  | 'total'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'customer'
  | 'vendor'
  | 'item'
  | 'class'
  | 'department'

export type QuickBooksAgingMethod = 'default' | 'report_date' | 'current'

export type QuickBooksTransactionListPaidStatus = 'default' | 'all' | 'paid' | 'unpaid'
export type QuickBooksTransactionListClearedStatus =
  | 'default'
  | 'cleared'
  | 'uncleared'
  | 'reconciled'
  | 'deposited'
export type QuickBooksTransactionListGroupBy =
  | 'default'
  | 'account'
  | 'customer'
  | 'day'
  | 'employee'
  | 'department'
  | 'month'
  | 'name'
  | 'none'
  | 'payment_method'
  | 'quarter'
  | 'transaction_type'
  | 'vendor'
  | 'week'
  | 'year'

export type QuickBooksTransactionListTransactionType =
  | 'default'
  | 'bill'
  | 'bill_payment_check'
  | 'bill_payment_credit_card'
  | 'cash_purchase'
  | 'check'
  | 'credit_card_charge'
  | 'credit_card_credit'
  | 'credit_memo'
  | 'deposit'
  | 'estimate'
  | 'invoice'
  | 'journal_entry'
  | 'payment'
  | 'purchase_order'
  | 'sales_receipt'
  | 'transfer'
  | 'vendor_credit'

export type QuickBooksTransactionListSourceAccountType =
  | 'default'
  | 'accounts_payable'
  | 'accounts_receivable'
  | 'bank'
  | 'cost_of_goods_sold'
  | 'credit_card'
  | 'equity'
  | 'expense'
  | 'fixed_asset'
  | 'income'
  | 'long_term_liability'
  | 'non_posting'
  | 'other_asset'
  | 'other_current_asset'
  | 'other_current_liability'
  | 'other_expense'
  | 'other_income'

export interface QuickBooksRunFinancialReportParams extends QuickBooksAuthParams {
  reportType: QuickBooksReportType
  startDate?: string
  endDate?: string
  dateMacro?: QuickBooksReportDateMacro
  accountingMethod?: QuickBooksAccountingMethod
  summarizeBy?: QuickBooksReportSummarizeBy
  quickZoomUrl?: boolean
  customerId?: string
  vendorId?: string
  accountId?: string
  employeeId?: string
  itemId?: string
  classId?: string
  departmentId?: string
  agingMethod?: QuickBooksAgingMethod
  agingDays?: number
  transactionType?: QuickBooksTransactionListTransactionType
  groupBy?: QuickBooksTransactionListGroupBy
  accountsPayablePaid?: QuickBooksTransactionListPaidStatus
  accountsReceivablePaid?: QuickBooksTransactionListPaidStatus
  clearedStatus?: QuickBooksTransactionListClearedStatus
  documentNumber?: string
  sourceAccountType?: QuickBooksTransactionListSourceAccountType
}

export type QuickBooksDocumentTransactionType =
  | 'credit_memo'
  | 'estimate'
  | 'invoice'
  | 'payment'
  | 'purchase_order'
  | 'refund_receipt'
  | 'sales_receipt'

export type QuickBooksAttachmentTargetType =
  | 'bill'
  | 'bill_payment'
  | 'credit_memo'
  | 'deposit'
  | 'estimate'
  | 'invoice'
  | 'item'
  | 'journal_entry'
  | 'payment'
  | 'purchase'
  | 'purchase_order'
  | 'refund_receipt'
  | 'sales_receipt'
  | 'vendor_credit'

export type QuickBooksAttachmentReadMode = 'list' | 'by_id'
export type QuickBooksAttachmentKind = 'file' | 'note'

export interface QuickBooksAttachableReference {
  EntityRef?: QuickBooksReference & { type?: string }
  IncludeOnSend?: boolean
  [key: string]: unknown
}

export interface QuickBooksAttachable {
  Id: string
  SyncToken?: string
  FileName?: string
  ContentType?: string
  Size?: number
  Note?: string
  Category?: string
  AttachableRef?: QuickBooksAttachableReference[]
  MetaData?: QuickBooksMetaData
  domain?: string
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksEmailTransactionParams extends QuickBooksAuthParams {
  transactionType: QuickBooksDocumentTransactionType
  transactionId: string
  recipient?: string
  confirmSend: boolean
}

export interface QuickBooksDownloadTransactionPdfParams extends QuickBooksAuthParams {
  transactionType: QuickBooksDocumentTransactionType
  transactionId: string
  fileName?: string
}

export interface QuickBooksReadAttachmentsParams extends QuickBooksAuthParams {
  readMode: QuickBooksAttachmentReadMode
  targetType?: QuickBooksAttachmentTargetType
  targetId?: string
  attachmentId?: string
  startPosition?: number
  maxResults?: number
}

export interface QuickBooksAddAttachmentParams extends QuickBooksAuthParams {
  attachmentKind: QuickBooksAttachmentKind
  targetType: QuickBooksAttachmentTargetType
  targetId: string
  file?: RawFileInput
  fileName?: string
  contentType?: string
  description?: string
  note?: string
}

export interface QuickBooksDownloadAttachmentParams extends QuickBooksAuthParams {
  attachmentId: string
  fileName?: string
}

export interface QuickBooksReportOption {
  Name?: string
  Value?: string
  [key: string]: unknown
}

export interface QuickBooksReportHeader {
  Time?: string
  ReportName?: string
  DateMacro?: string
  ReportBasis?: string
  StartPeriod?: string
  EndPeriod?: string
  SummarizeColumnsBy?: string
  Currency?: string
  Customer?: string
  Vendor?: string
  Account?: string
  Employee?: string
  Item?: string
  Class?: string
  Department?: string
  Option?: QuickBooksReportOption[]
  [key: string]: unknown
}

export interface QuickBooksReportColumnMetaData {
  Name?: string
  Value?: string
  [key: string]: unknown
}

export interface QuickBooksReportColumn {
  ColTitle?: string
  ColType?: string
  MetaData?: QuickBooksReportColumnMetaData[]
  [key: string]: unknown
}

export interface QuickBooksReportColumns {
  Column?: QuickBooksReportColumn[]
  [key: string]: unknown
}

export interface QuickBooksReportColumnData {
  value?: string
  id?: string
  href?: string
  [key: string]: unknown
}

export interface QuickBooksReportRowSummary {
  ColData?: QuickBooksReportColumnData[]
  [key: string]: unknown
}

export interface QuickBooksReportRowHeader {
  ColData?: QuickBooksReportColumnData[]
  [key: string]: unknown
}

export interface QuickBooksReportRow {
  type?: string
  group?: string
  Header?: QuickBooksReportRowHeader
  ColData?: QuickBooksReportColumnData[]
  Rows?: QuickBooksReportRows
  Summary?: QuickBooksReportRowSummary
  [key: string]: unknown
}

export interface QuickBooksReportRows {
  Row?: QuickBooksReportRow[]
  [key: string]: unknown
}

export type QuickBooksJournalPostingType = 'debit' | 'credit'
export type QuickBooksJournalEntityType = 'customer' | 'vendor' | 'employee'

export interface QuickBooksJournalLineInput {
  postingType: QuickBooksJournalPostingType
  amount: number
  accountId: string
  description?: string
  entityType?: QuickBooksJournalEntityType
  entityId?: string
}

export interface QuickBooksDepositLineInput {
  amount: number
  accountId: string
  description?: string
}

export interface QuickBooksCreateJournalEntryParams extends QuickBooksAuthParams {
  lines: QuickBooksJournalLineInput[]
  confirmPosting: boolean
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
  requestId?: string
}

export interface QuickBooksUpdateJournalEntryParams extends QuickBooksAuthParams {
  journalEntryId: string
  syncToken: string
  confirmPosting: boolean
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
}

export interface QuickBooksCreateDepositParams extends QuickBooksAuthParams {
  depositAccountId: string
  lines: QuickBooksDepositLineInput[]
  transactionDate?: string
  privateNote?: string
  requestId?: string
}

export interface QuickBooksUpdateDepositParams extends QuickBooksAuthParams {
  depositId: string
  syncToken: string
  depositAccountId: string
  transactionDate?: string
  privateNote?: string
}

export type QuickBooksPurchasingLineType = 'account' | 'item'

export interface QuickBooksPurchasingLineInput {
  lineType: QuickBooksPurchasingLineType
  amount: number
  accountId?: string
  itemId?: string
  description?: string
  quantity?: number
  unitPrice?: number
}

export interface QuickBooksBillLineInput extends QuickBooksPurchasingLineInput {
  purchaseOrderId?: string
  purchaseOrderLineId?: string
}

export interface QuickBooksBillLinkInput {
  purchaseOrderId: string
  purchaseOrderLineId: string
}

export interface QuickBooksLinkedBillLine extends QuickBooksBillLinkInput {
  billLineId?: string
}

export interface QuickBooksBillAllocationInput {
  billId: string
  amount: number
}

export interface QuickBooksCreatePurchaseOrderParams extends QuickBooksAuthParams {
  vendorId: string
  apAccountId: string
  lines: QuickBooksPurchasingLineInput[]
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
  requestId?: string
}

export interface QuickBooksUpdatePurchaseOrderParams extends QuickBooksAuthParams {
  purchaseOrderId: string
  syncToken: string
  vendorId?: string
  apAccountId?: string
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
}

export interface QuickBooksCreateBillParams extends QuickBooksAuthParams {
  vendorId: string
  lines: QuickBooksBillLineInput[]
  apAccountId?: string
  transactionDate?: string
  dueDate?: string
  documentNumber?: string
  privateNote?: string
  requestId?: string
}

export interface QuickBooksUpdateBillParams extends QuickBooksAuthParams {
  billId: string
  syncToken: string
  vendorId?: string
  apAccountId?: string
  transactionDate?: string
  dueDate?: string
  documentNumber?: string
  privateNote?: string
}

export type QuickBooksBillPaymentType = 'check' | 'credit_card'

export interface QuickBooksCreateBillPaymentParams extends QuickBooksAuthParams {
  vendorId: string
  totalAmount: number
  paymentType: QuickBooksBillPaymentType
  paymentAccountId: string
  billAllocations?: QuickBooksBillAllocationInput[]
  transactionDate?: string
  privateNote?: string
  requestId?: string
}

export interface QuickBooksUpdateBillPaymentParams extends QuickBooksAuthParams {
  billPaymentId: string
  syncToken: string
  vendorId?: string
  transactionDate?: string
  privateNote?: string
}

export interface QuickBooksCreateVendorCreditParams extends QuickBooksAuthParams {
  vendorId: string
  lines: QuickBooksPurchasingLineInput[]
  apAccountId?: string
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
  requestId?: string
}

export interface QuickBooksUpdateVendorCreditParams extends QuickBooksAuthParams {
  vendorCreditId: string
  syncToken: string
  vendorId?: string
  apAccountId?: string
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
}

export type QuickBooksPurchasePaymentType = 'cash' | 'check' | 'credit_card'

export interface QuickBooksCreatePurchaseParams extends QuickBooksAuthParams {
  paymentType: QuickBooksPurchasePaymentType
  paymentAccountId: string
  lines: QuickBooksPurchasingLineInput[]
  vendorId?: string
  transactionDate?: string
  paymentReference?: string
  privateNote?: string
  requestId?: string
}

export interface QuickBooksUpdatePurchaseParams extends QuickBooksAuthParams {
  purchaseId: string
  syncToken: string
  vendorId?: string
  transactionDate?: string
  paymentReference?: string
  privateNote?: string
}

export type QuickBooksSalesLineType = 'item' | 'description'

export interface QuickBooksSalesLineInput {
  lineType: QuickBooksSalesLineType
  amount?: number
  itemId?: string
  description?: string
  quantity?: number
  unitPrice?: number
  serviceDate?: string
}

export interface QuickBooksCreateSalesDocumentParams extends QuickBooksAuthParams {
  customerId: string
  lines: QuickBooksSalesLineInput[]
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
  customerMemo?: string
  dueDate?: string
  expirationDate?: string
  paymentMethodId?: string
  paymentReferenceNumber?: string
  depositAccountId?: string
  requestId?: string
}

export interface QuickBooksUpdateSalesDocumentParams
  extends Omit<QuickBooksCreateSalesDocumentParams, 'customerId' | 'lines' | 'requestId'> {
  transactionId: string
  syncToken: string
  customerId?: string
  lines?: QuickBooksSalesLineInput[]
}

type QuickBooksNonReceiptCreateParams = Omit<
  QuickBooksCreateSalesDocumentParams,
  'paymentMethodId' | 'paymentReferenceNumber' | 'depositAccountId'
>
type QuickBooksNonReceiptUpdateParams = Omit<
  QuickBooksUpdateSalesDocumentParams,
  'paymentMethodId' | 'paymentReferenceNumber' | 'depositAccountId'
>

export type QuickBooksCreateEstimateParams = Omit<QuickBooksNonReceiptCreateParams, 'dueDate'>
export type QuickBooksUpdateEstimateParams = Omit<QuickBooksNonReceiptUpdateParams, 'dueDate'>
export type QuickBooksCreateInvoiceParams = Omit<QuickBooksNonReceiptCreateParams, 'expirationDate'>
export type QuickBooksUpdateInvoiceParams = Omit<QuickBooksNonReceiptUpdateParams, 'expirationDate'>
export type QuickBooksCreateSalesReceiptParams = Omit<
  QuickBooksCreateSalesDocumentParams,
  'dueDate' | 'expirationDate'
>
export type QuickBooksUpdateSalesReceiptParams = Omit<
  QuickBooksUpdateSalesDocumentParams,
  'dueDate' | 'expirationDate'
>
export type QuickBooksCreateCreditMemoParams = Omit<
  QuickBooksNonReceiptCreateParams,
  'dueDate' | 'expirationDate'
>
export type QuickBooksUpdateCreditMemoParams = Omit<
  QuickBooksNonReceiptUpdateParams,
  'dueDate' | 'expirationDate'
>
export type QuickBooksCreateRefundReceiptParams = Omit<
  QuickBooksCreateSalesReceiptParams,
  'depositAccountId'
> & { depositAccountId: string }
export type QuickBooksUpdateRefundReceiptParams = QuickBooksUpdateSalesReceiptParams

export interface QuickBooksInvoiceAllocationInput {
  invoiceId: string
  amount: number
}

export interface QuickBooksCreateCustomerPaymentParams extends QuickBooksAuthParams {
  customerId: string
  totalAmount: number
  transactionDate?: string
  privateNote?: string
  paymentReferenceNumber?: string
  paymentMethodId?: string
  depositAccountId?: string
  invoiceAllocations?: QuickBooksInvoiceAllocationInput[]
  requestId?: string
}

export interface QuickBooksUpdateCustomerPaymentParams
  extends Omit<QuickBooksCreateCustomerPaymentParams, 'customerId' | 'totalAmount' | 'requestId'> {
  paymentId: string
  syncToken: string
  customerId?: string
  totalAmount?: number
  /**
   * Replace the payment's invoice allocations outright instead of merging the
   * supplied allocations into the ones already on the payment. Every invoice
   * omitted from `invoiceAllocations` is unapplied.
   */
  unapplyOmittedInvoices?: boolean
}

export interface QuickBooksVoidTransactionParams extends QuickBooksAuthParams {
  transactionId: string
  syncToken: string
  confirmVoid: boolean
}

export type QuickBooksActiveStatus = 'unchanged' | 'active' | 'inactive'
export type QuickBooksReadActiveStatus = 'default' | 'active' | 'inactive'

export interface QuickBooksCreateCustomerParams extends QuickBooksAuthParams {
  displayName?: string
  requestId?: string
  companyName?: string
  givenName?: string
  familyName?: string
  primaryEmail?: string
  primaryPhone?: string
  billingAddress?: QuickBooksAddress
  shippingAddress?: QuickBooksAddress
  taxable?: boolean
}

export interface QuickBooksUpdateCustomerParams
  extends Omit<QuickBooksCreateCustomerParams, 'displayName'> {
  customerId: string
  syncToken: string
  displayName?: string
  activeStatus?: QuickBooksActiveStatus
}

export interface QuickBooksCreateEmployeeParams extends QuickBooksAuthParams {
  displayName?: string
  requestId?: string
  givenName?: string
  familyName?: string
  primaryEmail?: string
  primaryPhone?: string
  primaryAddress?: QuickBooksAddress
  printOnCheckName?: string
  billableTime?: boolean
}

export interface QuickBooksUpdateEmployeeParams
  extends Omit<QuickBooksCreateEmployeeParams, 'displayName' | 'requestId'> {
  employeeId: string
  syncToken: string
  displayName?: string
  activeStatus?: QuickBooksActiveStatus
}

export interface QuickBooksCreateVendorParams extends QuickBooksAuthParams {
  displayName?: string
  requestId?: string
  companyName?: string
  givenName?: string
  familyName?: string
  primaryEmail?: string
  primaryPhone?: string
  billingAddress?: QuickBooksAddress
  printOnCheckName?: string
  accountNumber?: string
  vendor1099?: boolean
}

export interface QuickBooksUpdateVendorParams
  extends Omit<QuickBooksCreateVendorParams, 'displayName'> {
  vendorId: string
  syncToken: string
  displayName?: string
  activeStatus?: QuickBooksActiveStatus
}

export type QuickBooksWritableItemType = 'service' | 'non_inventory'

export interface QuickBooksCreateItemParams extends QuickBooksAuthParams {
  name: string
  itemType: QuickBooksWritableItemType
  expenseAccountId?: string
  incomeAccountId?: string
  requestId?: string
  description?: string
  unitPrice?: number
  purchaseDescription?: string
  purchaseCost?: number
  taxable?: boolean
}

export interface QuickBooksUpdateItemParams
  extends Omit<QuickBooksCreateItemParams, 'name' | 'itemType'> {
  itemId: string
  syncToken: string
  name?: string
  activeStatus?: QuickBooksActiveStatus
}

export interface QuickBooksCompanyInfoResponse extends ToolResponse {
  output: {
    company: QuickBooksCompanyInfo
    time: string | null
  }
}

export interface QuickBooksListResponse<T> extends ToolResponse {
  output: {
    items: T[]
    startPosition: number
    maxResults: number
    nextStartPosition: number
    hasMore: boolean
    time: string | null
  }
}

export interface QuickBooksReadMasterDataResponse extends ToolResponse {
  output: {
    recordType: QuickBooksMasterDataRecordType
    item?: QuickBooksMasterDataRecord
    recordVersion?: string
    items?: QuickBooksMasterDataRecord[]
    startPosition?: number
    maxResults?: number
    nextStartPosition?: number
    hasMore?: boolean
    time: string | null
  }
}

export interface QuickBooksReadSalesTransactionsResponse extends ToolResponse {
  output: {
    transactionType: QuickBooksSalesTransactionType
    item?: QuickBooksSalesTransaction
    recordVersion?: string
    items?: QuickBooksSalesTransaction[]
    startPosition?: number
    maxResults?: number
    nextStartPosition?: number
    hasMore?: boolean
    time: string | null
  }
}

export interface QuickBooksReadPurchasingTransactionsResponse extends ToolResponse {
  output: {
    transactionType: QuickBooksPurchasingTransactionType
    item?: QuickBooksPurchasingTransaction
    recordVersion?: string
    items?: QuickBooksPurchasingTransaction[]
    startPosition?: number
    maxResults?: number
    nextStartPosition?: number
    hasMore?: boolean
    time: string | null
  }
}

export interface QuickBooksReadAccountingTransactionsResponse extends ToolResponse {
  output: {
    transactionType: QuickBooksAccountingTransactionType
    item?: QuickBooksAccountingTransaction
    recordVersion?: string
    items?: QuickBooksAccountingTransaction[]
    startPosition?: number
    maxResults?: number
    nextStartPosition?: number
    hasMore?: boolean
    time: string | null
  }
}

export interface QuickBooksRunFinancialReportResponse extends ToolResponse {
  output: {
    reportType: QuickBooksReportType
    header: QuickBooksReportHeader
    columns: QuickBooksReportColumns
    rows: QuickBooksReportRows
    time: string | null
  }
}

export interface QuickBooksEmailTransactionResponse extends ToolResponse {
  output: {
    transactionType: QuickBooksDocumentTransactionType
    transactionId: string
    sent: true
    record?: QuickBooksTransaction
    time: string | null
  }
}

export interface QuickBooksReadAttachmentsResponse extends ToolResponse {
  output: {
    item?: QuickBooksAttachable
    items?: QuickBooksAttachable[]
    startPosition?: number
    maxResults?: number
    nextStartPosition?: number
    hasMore?: boolean
    time: string | null
  }
}

export interface QuickBooksAddAttachmentResponse extends ToolResponse {
  output: {
    attachment: QuickBooksAttachable
    attachmentId: string
    attachmentKind: QuickBooksAttachmentKind
    targetType: QuickBooksAttachmentTargetType
    targetId: string
    time: string | null
  }
}

export interface QuickBooksFileResponse extends ToolResponse {
  output: {
    file: UserFile
    transactionType?: QuickBooksDocumentTransactionType
    transactionId?: string
    attachmentId?: string
    fileName: string
    mimeType: string
    size: number
  }
}

export interface QuickBooksMutationResponse<T extends { Id: string; SyncToken?: string }>
  extends ToolResponse {
  output: {
    record: T
    recordId: string
    syncToken: string
    recordVersion: string
    time: string | null
  }
}

export interface QuickBooksCreateBillResponse
  extends QuickBooksMutationResponse<QuickBooksPurchasingTransaction> {
  output: QuickBooksMutationResponse<QuickBooksPurchasingTransaction>['output'] & {
    linkingRequested: boolean
    linkingSucceeded: boolean | null
    linkedLines: QuickBooksLinkedBillLine[]
    missingLinks: QuickBooksBillLinkInput[]
    linkingWarning?: string
  }
}

export interface QuickBooksVoidResponse extends ToolResponse {
  output: {
    record: QuickBooksSalesTransaction
    recordId: string
    syncToken: string
    voided: true
    time: string | null
  }
}

export type QuickBooksResponse =
  | QuickBooksCompanyInfoResponse
  | QuickBooksListResponse<QuickBooksPurchaseOrder | QuickBooksBill>
  | QuickBooksReadMasterDataResponse
  | QuickBooksReadSalesTransactionsResponse
  | QuickBooksReadPurchasingTransactionsResponse
  | QuickBooksReadAccountingTransactionsResponse
  | QuickBooksRunFinancialReportResponse
  | QuickBooksEmailTransactionResponse
  | QuickBooksReadAttachmentsResponse
  | QuickBooksAddAttachmentResponse
  | QuickBooksFileResponse
  | QuickBooksMutationResponse<
      QuickBooksCustomer | QuickBooksEmployee | QuickBooksVendor | QuickBooksItem
    >
  | QuickBooksMutationResponse<QuickBooksSalesTransaction>
  | QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
  | QuickBooksCreateBillResponse
  | QuickBooksMutationResponse<QuickBooksAccountingTransaction>
  | QuickBooksVoidResponse

export const QUICKBOOKS_REFERENCE_PROPERTIES: Record<string, OutputProperty> = {
  value: { type: 'string', description: 'QuickBooks entity ID', optional: true },
  name: { type: 'string', description: 'QuickBooks entity display name', optional: true },
}

export const QUICKBOOKS_METADATA_PROPERTIES: Record<string, OutputProperty> = {
  CreateTime: { type: 'string', description: 'Entity creation timestamp', optional: true },
  LastUpdatedTime: {
    type: 'string',
    description: 'Entity last-updated timestamp',
    optional: true,
  },
}

export const QUICKBOOKS_COMPANY_INFO_PROPERTIES: Record<string, OutputProperty> = {
  Id: {
    type: 'string',
    description: 'QuickBooks CompanyInfo entity ID (commonly "1"); this is not the OAuth realmId',
  },
  SyncToken: { type: 'string', description: 'CompanyInfo sync token', optional: true },
  CompanyName: { type: 'string', description: 'Company display name', optional: true },
  LegalName: { type: 'string', description: 'Company legal name', optional: true },
  CompanyAddr: { type: 'json', description: 'Company address', optional: true },
  CustomerCommunicationAddr: {
    type: 'json',
    description: 'Customer communication address',
    optional: true,
  },
  LegalAddr: { type: 'json', description: 'Company legal address', optional: true },
  PrimaryPhone: { type: 'json', description: 'Primary phone details', optional: true },
  Email: { type: 'json', description: 'Company email details', optional: true },
  WebAddr: { type: 'json', description: 'Company website details', optional: true },
  CompanyStartDate: {
    type: 'string',
    description: 'Company start date',
    optional: true,
  },
  Country: { type: 'string', description: 'Company country code', optional: true },
  FiscalYearStartMonth: {
    type: 'string',
    description: 'Fiscal year starting month',
    optional: true,
  },
  SupportedLanguages: {
    type: 'string',
    description: 'Comma-separated list of languages supported by the company',
    optional: true,
  },
  domain: { type: 'string', description: 'Originating Intuit domain', optional: true },
  sparse: {
    type: 'boolean',
    description: 'Whether QuickBooks returned a partial representation',
    optional: true,
  },
  NameValue: {
    type: 'array',
    description: 'QuickBooks company settings represented as name/value entries',
    optional: true,
    items: { type: 'json' },
  },
  MetaData: {
    type: 'json',
    description: 'CompanyInfo creation and update timestamps',
    optional: true,
    properties: QUICKBOOKS_METADATA_PROPERTIES,
  },
}

/**
 * Pagination outputs shared by QuickBooks read tools.
 *
 * Every field is optional because tools that expose both a list and a by-ID
 * read mode reuse this map for a single declared output shape, and the by-ID
 * branch returns only the record and the response timestamp.
 */
export const QUICKBOOKS_LIST_OUTPUTS: Record<string, OutputProperty> = {
  startPosition: {
    type: 'number',
    description: 'One-based position of the first item in this response',
    optional: true,
  },
  maxResults: {
    type: 'number',
    description: 'Actual number of items reported for this response',
    optional: true,
  },
  nextStartPosition: {
    type: 'number',
    description: 'Position to use when explicitly requesting the next page',
    optional: true,
  },
  hasMore: {
    type: 'boolean',
    description: 'Conservative indication that another page may exist',
    optional: true,
  },
  time: {
    type: 'string',
    description: 'QuickBooks response timestamp',
    optional: true,
    nullable: true,
  },
}

export const QUICKBOOKS_ATTACHABLE_PROPERTIES: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks attachment ID' },
  SyncToken: { type: 'string', description: 'Attachment sync token', optional: true },
  FileName: { type: 'string', description: 'Attached file name', optional: true },
  ContentType: { type: 'string', description: 'Attached file MIME type', optional: true },
  Size: { type: 'number', description: 'Attached file size in bytes', optional: true },
  Note: { type: 'string', description: 'Attachment note or description', optional: true },
  Category: {
    type: 'string',
    description: 'Native QuickBooks attachment category',
    optional: true,
  },
  AttachableRef: {
    type: 'array',
    description: 'QuickBooks entities referenced by this attachment',
    optional: true,
    items: {
      type: 'json',
      properties: {
        EntityRef: {
          type: 'json',
          description: 'Attached entity type and operational ID',
          optional: true,
        },
        IncludeOnSend: {
          type: 'boolean',
          description: 'Whether QuickBooks includes the attachment when sending',
          optional: true,
        },
      },
    },
  },
  MetaData: {
    type: 'json',
    description: 'Attachment creation and update timestamps',
    optional: true,
    properties: QUICKBOOKS_METADATA_PROPERTIES,
  },
  domain: { type: 'string', description: 'QuickBooks domain', optional: true },
  sparse: { type: 'boolean', description: 'Whether this is a sparse entity', optional: true },
}

export const QUICKBOOKS_FILE_OUTPUTS: Record<string, OutputProperty> = {
  file: { type: 'file', description: 'Downloaded file stored in execution files' },
  fileName: { type: 'string', description: 'Safe downloaded filename' },
  mimeType: { type: 'string', description: 'Downloaded file MIME type' },
  size: { type: 'number', description: 'Downloaded file size in bytes' },
}

export const QUICKBOOKS_ENTITY_BASE_PROPERTIES: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks entity ID' },
  SyncToken: { type: 'string', description: 'Entity sync token', optional: true },
  Active: { type: 'boolean', description: 'Whether the entity is active', optional: true },
  MetaData: {
    type: 'json',
    description: 'Entity creation and update timestamps',
    optional: true,
    properties: QUICKBOOKS_METADATA_PROPERTIES,
  },
}

export const QUICKBOOKS_ACCOUNT_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_ENTITY_BASE_PROPERTIES,
  Name: { type: 'string', description: 'Account name', optional: true },
  SubAccount: { type: 'boolean', description: 'Whether this is a subaccount', optional: true },
  ParentRef: {
    type: 'json',
    description: 'Parent account reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  FullyQualifiedName: {
    type: 'string',
    description: 'Hierarchical qualified name',
    optional: true,
  },
  Classification: {
    type: 'string',
    description: 'Account classification',
    optional: true,
  },
  AccountType: { type: 'string', description: 'Account type', optional: true },
  AccountSubType: { type: 'string', description: 'Account subtype', optional: true },
  CurrentBalance: { type: 'number', description: 'Account current balance', optional: true },
  CurrencyRef: {
    type: 'json',
    description: 'Account currency reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
}

export const QUICKBOOKS_CUSTOMER_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_ENTITY_BASE_PROPERTIES,
  DisplayName: {
    type: 'string',
    description: 'Customer display name',
    optional: true,
  },
  CompanyName: { type: 'string', description: 'Customer company name', optional: true },
  GivenName: { type: 'string', description: 'Given name', optional: true },
  FamilyName: { type: 'string', description: 'Family name', optional: true },
  Taxable: { type: 'boolean', description: 'Whether the customer is taxable', optional: true },
  PrimaryEmailAddr: {
    type: 'json',
    description: 'Customer primary email address',
    optional: true,
  },
  PrimaryPhone: {
    type: 'json',
    description: 'Customer primary phone number',
    optional: true,
  },
  BillAddr: { type: 'json', description: 'Customer billing address', optional: true },
  ShipAddr: { type: 'json', description: 'Customer shipping address', optional: true },
  Balance: { type: 'number', description: 'Customer balance', optional: true },
  CurrencyRef: {
    type: 'json',
    description: 'Customer currency reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
}

export const QUICKBOOKS_VENDOR_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_ENTITY_BASE_PROPERTIES,
  DisplayName: { type: 'string', description: 'Vendor display name', optional: true },
  CompanyName: { type: 'string', description: 'Vendor company name', optional: true },
  GivenName: { type: 'string', description: 'Given name', optional: true },
  FamilyName: { type: 'string', description: 'Family name', optional: true },
  PrintOnCheckName: {
    type: 'string',
    description: 'Name printed on checks',
    optional: true,
  },
  Vendor1099: {
    type: 'boolean',
    description: 'Whether the vendor is tracked for 1099 reporting',
    optional: true,
  },
  PrimaryEmailAddr: {
    type: 'json',
    description: 'Vendor primary email address',
    optional: true,
  },
  PrimaryPhone: {
    type: 'json',
    description: 'Vendor primary phone number',
    optional: true,
  },
  BillAddr: { type: 'json', description: 'Vendor billing address', optional: true },
  AcctNum: { type: 'string', description: 'Vendor account number', optional: true },
  Balance: { type: 'number', description: 'Vendor balance', optional: true },
  CurrencyRef: {
    type: 'json',
    description: 'Vendor currency reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
}

export const QUICKBOOKS_ITEM_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_ENTITY_BASE_PROPERTIES,
  Name: { type: 'string', description: 'Item name', optional: true },
  Description: { type: 'string', description: 'Item sales description', optional: true },
  FullyQualifiedName: {
    type: 'string',
    description: 'Hierarchical qualified item name',
    optional: true,
  },
  Taxable: { type: 'boolean', description: 'Whether the item is taxable', optional: true },
  UnitPrice: { type: 'number', description: 'Item sale price', optional: true },
  Type: { type: 'string', description: 'Item type', optional: true },
  IncomeAccountRef: {
    type: 'json',
    description: 'Item income account reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  ExpenseAccountRef: {
    type: 'json',
    description: 'Item expense account reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  PurchaseDesc: { type: 'string', description: 'Item purchase description', optional: true },
  PurchaseCost: { type: 'number', description: 'Item purchase cost', optional: true },
  AssetAccountRef: {
    type: 'json',
    description: 'Inventory asset account reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  TrackQtyOnHand: {
    type: 'boolean',
    description: 'Whether QuickBooks tracks quantity on hand',
    optional: true,
  },
  QtyOnHand: { type: 'number', description: 'Current quantity on hand', optional: true },
  InvStartDate: { type: 'string', description: 'Inventory tracking start date', optional: true },
  ParentRef: {
    type: 'json',
    description: 'Parent item or category reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
}

export const QUICKBOOKS_EMPLOYEE_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_ENTITY_BASE_PROPERTIES,
  DisplayName: { type: 'string', description: 'Employee display name', optional: true },
  GivenName: { type: 'string', description: 'Given name', optional: true },
  FamilyName: { type: 'string', description: 'Family name', optional: true },
  PrintOnCheckName: {
    type: 'string',
    description: 'Employee name printed on checks',
    optional: true,
  },
  PrimaryEmailAddr: {
    type: 'json',
    description: 'Employee primary email address',
    optional: true,
  },
  PrimaryPhone: {
    type: 'json',
    description: 'Employee primary phone number',
    optional: true,
  },
  PrimaryAddr: { type: 'json', description: 'Employee primary address', optional: true },
  BillableTime: {
    type: 'boolean',
    description: 'Whether employee time is billable',
    optional: true,
  },
  domain: { type: 'string', description: 'QuickBooks domain', optional: true },
  sparse: { type: 'boolean', description: 'Whether this is a sparse entity', optional: true },
}

export const QUICKBOOKS_MASTER_DATA_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_ACCOUNT_PROPERTIES,
  ...QUICKBOOKS_CUSTOMER_PROPERTIES,
  ...QUICKBOOKS_VENDOR_PROPERTIES,
  ...QUICKBOOKS_ITEM_PROPERTIES,
  ...QUICKBOOKS_EMPLOYEE_PROPERTIES,
  PrintOnCheckName: {
    type: 'string',
    description: 'Vendor or employee name printed on checks',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'Account, item, class, or department name',
    optional: true,
  },
  ParentRef: {
    type: 'json',
    description: 'Parent account, item, class, or department reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  FullyQualifiedName: {
    type: 'string',
    description: 'Hierarchical qualified account, item, class, or department name',
    optional: true,
  },
  CurrencyRef: {
    type: 'json',
    description: 'Account, customer, or vendor currency reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  DisplayName: {
    type: 'string',
    description: 'Customer, vendor, or employee display name',
    optional: true,
  },
  CompanyName: {
    type: 'string',
    description: 'Customer or vendor company name',
    optional: true,
  },
  Taxable: {
    type: 'boolean',
    description: 'Taxable status for the customer or item',
    optional: true,
  },
  PrimaryEmailAddr: {
    type: 'json',
    description: 'Customer, vendor, or employee primary email address',
    optional: true,
  },
  PrimaryPhone: {
    type: 'json',
    description: 'Customer, vendor, or employee primary phone number',
    optional: true,
  },
  BillAddr: {
    type: 'json',
    description: 'Customer or vendor billing address',
    optional: true,
  },
  Balance: {
    type: 'number',
    description: 'Customer or vendor balance',
    optional: true,
  },
  SubClass: {
    type: 'boolean',
    description: 'Whether the Class is nested under another Class',
    optional: true,
  },
  SubDepartment: {
    type: 'boolean',
    description: 'Whether the Department is nested under another Department',
    optional: true,
  },
}

export const QUICKBOOKS_REPORT_HEADER_PROPERTIES: Record<string, OutputProperty> = {
  Time: { type: 'string', description: 'QuickBooks report generation timestamp', optional: true },
  ReportName: { type: 'string', description: 'Native QuickBooks report name', optional: true },
  DateMacro: {
    type: 'string',
    description: 'QuickBooks date macro, when returned',
    optional: true,
  },
  ReportBasis: { type: 'string', description: 'Cash or accrual basis', optional: true },
  StartPeriod: { type: 'string', description: 'Report start date', optional: true },
  EndPeriod: { type: 'string', description: 'Report end or as-of date', optional: true },
  SummarizeColumnsBy: {
    type: 'string',
    description: 'Dimension or time period used for report columns',
    optional: true,
  },
  Currency: { type: 'string', description: 'Report currency', optional: true },
  Customer: { type: 'string', description: 'Applied customer filter', optional: true },
  Vendor: { type: 'string', description: 'Applied vendor filter', optional: true },
  Account: { type: 'string', description: 'Applied account filter', optional: true },
  Employee: { type: 'string', description: 'Applied employee filter', optional: true },
  Item: { type: 'string', description: 'Applied item filter', optional: true },
  Class: { type: 'string', description: 'Applied class filter', optional: true },
  Department: { type: 'string', description: 'Applied department filter', optional: true },
  Option: {
    type: 'array',
    description: 'Native QuickBooks report options, including no-data indicators when present',
    optional: true,
    items: { type: 'json' },
  },
}

export const QUICKBOOKS_REPORT_COLUMNS_PROPERTIES: Record<string, OutputProperty> = {
  Column: {
    type: 'array',
    description: 'Native report column definitions with titles, types, and metadata',
    optional: true,
    items: {
      type: 'json',
      properties: {
        ColTitle: { type: 'string', description: 'Column title', optional: true },
        ColType: { type: 'string', description: 'QuickBooks column data type', optional: true },
        MetaData: {
          type: 'array',
          description: 'Native column metadata name/value entries',
          optional: true,
          items: { type: 'json' },
        },
      },
    },
  },
}

export const QUICKBOOKS_REPORT_ROWS_PROPERTIES: Record<string, OutputProperty> = {
  Row: {
    type: 'array',
    description:
      'Native hierarchical report rows; section rows may contain Header, nested Rows, and Summary, while data rows contain ColData values, IDs, and links',
    optional: true,
    items: {
      type: 'json',
      properties: {
        type: { type: 'string', description: 'QuickBooks row type', optional: true },
        group: { type: 'string', description: 'QuickBooks section group', optional: true },
        Header: { type: 'json', description: 'Section header column data', optional: true },
        ColData: {
          type: 'array',
          description: 'Row values with optional operational IDs and links',
          optional: true,
          items: { type: 'json' },
        },
        Rows: {
          type: 'json',
          description: 'Nested native QuickBooks report rows',
          optional: true,
        },
        Summary: { type: 'json', description: 'Section summary column data', optional: true },
      },
    },
  },
}

export const QUICKBOOKS_SALES_TRANSACTION_PROPERTIES: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks sales transaction ID' },
  SyncToken: { type: 'string', description: 'Current transaction sync token', optional: true },
  DocNumber: { type: 'string', description: 'Transaction document number', optional: true },
  TxnDate: { type: 'string', description: 'Transaction date', optional: true },
  DueDate: { type: 'string', description: 'Invoice due date', optional: true },
  ExpirationDate: { type: 'string', description: 'Estimate expiration date', optional: true },
  CustomerRef: {
    type: 'json',
    description: 'Customer reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  CustomerMemo: { type: 'json', description: 'Customer-facing memo', optional: true },
  DepositToAccountRef: {
    type: 'json',
    description: 'Deposit account reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  PaymentMethodRef: {
    type: 'json',
    description: 'Payment method reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  PaymentRefNum: {
    type: 'string',
    description: 'Customer payment reference number',
    optional: true,
  },
  CurrencyRef: {
    type: 'json',
    description: 'Transaction currency reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  Line: {
    type: 'array',
    description: 'Native QuickBooks transaction lines',
    optional: true,
    items: { type: 'json' },
  },
  LinkedTxn: {
    type: 'array',
    description: 'Transactions linked by QuickBooks',
    optional: true,
    items: { type: 'json' },
  },
  TotalAmt: { type: 'number', description: 'Transaction total amount', optional: true },
  Balance: { type: 'number', description: 'Remaining transaction balance', optional: true },
  UnappliedAmt: { type: 'number', description: 'Unapplied payment amount', optional: true },
  PrivateNote: { type: 'string', description: 'Internal transaction note', optional: true },
  TxnStatus: { type: 'string', description: 'Transaction status', optional: true },
  TxnTaxDetail: { type: 'json', description: 'Calculated tax details', optional: true },
  MetaData: {
    type: 'json',
    description: 'Transaction creation and update timestamps',
    optional: true,
    properties: QUICKBOOKS_METADATA_PROPERTIES,
  },
}

export const QUICKBOOKS_LINKED_TRANSACTION_PROPERTIES: Record<string, OutputProperty> = {
  TxnId: { type: 'string', description: 'Linked QuickBooks transaction ID', optional: true },
  TxnType: { type: 'string', description: 'Linked QuickBooks transaction type', optional: true },
  TxnLineId: {
    type: 'string',
    description: 'Linked QuickBooks transaction line ID',
    optional: true,
  },
}

export const QUICKBOOKS_PURCHASING_LINE_PROPERTIES: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks transaction line ID', optional: true },
  LineNum: { type: 'number', description: 'QuickBooks transaction line number', optional: true },
  Description: { type: 'string', description: 'Transaction line description', optional: true },
  Amount: { type: 'number', description: 'Transaction line amount', optional: true },
  DetailType: { type: 'string', description: 'QuickBooks line detail type', optional: true },
  LinkedTxn: {
    type: 'array',
    description: 'Transactions linked to this QuickBooks line',
    optional: true,
    items: { type: 'json', properties: QUICKBOOKS_LINKED_TRANSACTION_PROPERTIES },
  },
  AccountBasedExpenseLineDetail: {
    type: 'json',
    description: 'Native QuickBooks account-based expense details',
    optional: true,
  },
  ItemBasedExpenseLineDetail: {
    type: 'json',
    description: 'Native QuickBooks item-based expense details',
    optional: true,
  },
}

export const QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks purchasing transaction ID' },
  SyncToken: { type: 'string', description: 'Current transaction sync token', optional: true },
  DocNumber: { type: 'string', description: 'Transaction document number', optional: true },
  TxnDate: { type: 'string', description: 'Transaction date', optional: true },
  DueDate: { type: 'string', description: 'Bill due date', optional: true },
  VendorRef: {
    type: 'json',
    description: 'Vendor reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  APAccountRef: {
    type: 'json',
    description: 'Accounts-payable account reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  AccountRef: {
    type: 'json',
    description: 'Payment account reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  EntityRef: {
    type: 'json',
    description: 'Purchase payee reference',
    optional: true,
    properties: {
      ...QUICKBOOKS_REFERENCE_PROPERTIES,
      type: { type: 'string', description: 'Referenced entity type', optional: true },
    },
  },
  PaymentType: { type: 'string', description: 'Purchase payment type', optional: true },
  PayType: { type: 'string', description: 'Bill-payment type', optional: true },
  CheckPayment: {
    type: 'json',
    description: 'Check payment account details',
    optional: true,
  },
  CreditCardPayment: {
    type: 'json',
    description: 'Credit-card payment account details',
    optional: true,
  },
  PaymentRefNum: { type: 'string', description: 'Payment reference number', optional: true },
  CurrencyRef: {
    type: 'json',
    description: 'Transaction currency reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  Line: {
    type: 'array',
    description: 'Native QuickBooks expense or allocation lines',
    optional: true,
    items: { type: 'json', properties: QUICKBOOKS_PURCHASING_LINE_PROPERTIES },
  },
  LinkedTxn: {
    type: 'array',
    description: 'Transactions linked by QuickBooks',
    optional: true,
    items: { type: 'json', properties: QUICKBOOKS_LINKED_TRANSACTION_PROPERTIES },
  },
  TotalAmt: { type: 'number', description: 'Transaction total amount', optional: true },
  Balance: { type: 'number', description: 'Remaining transaction balance', optional: true },
  PrivateNote: { type: 'string', description: 'Internal transaction note', optional: true },
  MetaData: {
    type: 'json',
    description: 'Transaction creation and update timestamps',
    optional: true,
    properties: QUICKBOOKS_METADATA_PROPERTIES,
  },
}

export const QUICKBOOKS_EMAILABLE_TRANSACTION_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
  ...QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
  Id: { type: 'string', description: 'QuickBooks transaction ID' },
  DueDate: { type: 'string', description: 'Transaction due date', optional: true },
  POStatus: { type: 'string', description: 'Purchase order status', optional: true },
  Line: {
    type: 'array',
    description: 'Native QuickBooks sales or purchasing transaction lines',
    optional: true,
    items: {
      type: 'json',
      properties: {
        ...QUICKBOOKS_PURCHASING_LINE_PROPERTIES,
        SalesItemLineDetail: {
          type: 'json',
          description: 'Native QuickBooks sales item line details',
          optional: true,
        },
        DescriptionLineDetail: {
          type: 'json',
          description: 'Native QuickBooks description line details',
          optional: true,
        },
      },
    },
  },
}

export const QUICKBOOKS_ACCOUNTING_TRANSACTION_PROPERTIES: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks accounting transaction ID' },
  SyncToken: { type: 'string', description: 'Current transaction sync token', optional: true },
  DocNumber: { type: 'string', description: 'Transaction document number', optional: true },
  TxnDate: { type: 'string', description: 'Transaction date', optional: true },
  PrivateNote: { type: 'string', description: 'Internal transaction note', optional: true },
  Adjustment: {
    type: 'boolean',
    description: 'Whether the journal entry is an adjusting entry',
    optional: true,
  },
  DepositToAccountRef: {
    type: 'json',
    description: 'Account receiving a deposit',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  FromAccountRef: {
    type: 'json',
    description: 'Transfer source account',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  ToAccountRef: {
    type: 'json',
    description: 'Transfer destination account',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  Line: {
    type: 'array',
    description: 'Native QuickBooks journal or deposit lines',
    optional: true,
    items: { type: 'json' },
  },
  Amount: { type: 'number', description: 'Transfer amount', optional: true },
  TotalAmt: { type: 'number', description: 'Transaction total amount', optional: true },
  MetaData: {
    type: 'json',
    description: 'Transaction creation and update timestamps',
    optional: true,
    properties: QUICKBOOKS_METADATA_PROPERTIES,
  },
}

export const QUICKBOOKS_MUTATION_OUTPUTS: Record<string, OutputProperty> = {
  recordId: { type: 'string', description: 'ID of the created or updated QuickBooks entity' },
  syncToken: {
    type: 'string',
    description: 'Native QuickBooks SyncToken returned by the mutation',
  },
  recordVersion: {
    type: 'string',
    description:
      'Latest QuickBooks record version required for a subsequent update; this is the native SyncToken under a display-safe name',
  },
  time: {
    type: 'string',
    description: 'QuickBooks response timestamp',
    optional: true,
    nullable: true,
  },
}

export const QUICKBOOKS_BILL_LINK_INPUT_PROPERTIES: Record<string, OutputProperty> = {
  purchaseOrderId: { type: 'string', description: 'Requested Purchase Order ID' },
  purchaseOrderLineId: { type: 'string', description: 'Requested Purchase Order line ID' },
}

export const QUICKBOOKS_CREATE_BILL_LINK_OUTPUTS: Record<string, OutputProperty> = {
  linkingRequested: {
    type: 'boolean',
    description: 'Whether any Purchase Order line links were requested',
  },
  linkingSucceeded: {
    type: 'boolean',
    description: 'Whether QuickBooks returned every requested Purchase Order line link',
    nullable: true,
  },
  linkedLines: {
    type: 'array',
    description: 'Requested Purchase Order line links confirmed by QuickBooks',
    items: {
      type: 'json',
      properties: {
        ...QUICKBOOKS_BILL_LINK_INPUT_PROPERTIES,
        billLineId: {
          type: 'string',
          description: 'Created Bill line ID carrying the confirmed link',
          optional: true,
        },
      },
    },
  },
  missingLinks: {
    type: 'array',
    description: 'Requested Purchase Order line links omitted by QuickBooks',
    items: { type: 'json', properties: QUICKBOOKS_BILL_LINK_INPUT_PROPERTIES },
  },
  linkingWarning: {
    type: 'string',
    description: 'Warning that the Bill was created without every requested Purchase Order link',
    optional: true,
  },
}

export const QUICKBOOKS_VOID_OUTPUTS: Record<string, OutputProperty> = {
  ...QUICKBOOKS_MUTATION_OUTPUTS,
  voided: { type: 'boolean', description: 'Whether QuickBooks voided the transaction' },
}
