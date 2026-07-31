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
  DefaultTimeZone?: string
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
  DepositToAccountRef?: QuickBooksReference
  PaymentMethodRef?: QuickBooksReference
  PaymentRefNum?: string
  CurrencyRef?: QuickBooksReference
  ExchangeRate?: number
  Line?: Array<Record<string, unknown>>
  LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }>
  TotalAmt?: number
  Balance?: number
  UnappliedAmt?: number
  PrivateNote?: string
  TxnStatus?: string
  TxnTaxDetail?: Record<string, unknown>
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export type QuickBooksPurchaseOrder = QuickBooksTransaction
export type QuickBooksBill = QuickBooksTransaction
export type QuickBooksSalesTransaction = QuickBooksTransaction

export interface QuickBooksAuthParams {
  accessToken: string
  realmId: string
}

export type QuickBooksMasterDataRecordType = 'account' | 'customer' | 'vendor' | 'item' | 'employee'

export type QuickBooksMasterDataReadMode = 'list' | 'by_id'

export type QuickBooksMasterDataRecord =
  | QuickBooksAccount
  | QuickBooksCustomer
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
}

export interface QuickBooksVoidTransactionParams extends QuickBooksAuthParams {
  transactionId: string
  syncToken: string
  confirmVoid: boolean
}

export type QuickBooksActiveStatus = 'unchanged' | 'active' | 'inactive'

export interface QuickBooksCreateCustomerParams extends QuickBooksAuthParams {
  displayName: string
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

export interface QuickBooksCreateVendorParams extends QuickBooksAuthParams {
  displayName: string
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
  incomeAccountId: string
  requestId?: string
  description?: string
  unitPrice?: number
  purchaseDescription?: string
  purchaseCost?: number
  expenseAccountId?: string
  taxable?: boolean
}

export interface QuickBooksUpdateItemParams
  extends Omit<QuickBooksCreateItemParams, 'name' | 'itemType' | 'incomeAccountId'> {
  itemId: string
  syncToken: string
  name?: string
  incomeAccountId?: string
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
    items?: QuickBooksSalesTransaction[]
    startPosition?: number
    maxResults?: number
    nextStartPosition?: number
    hasMore?: boolean
    time: string | null
  }
}

export interface QuickBooksMutationResponse<T extends { Id: string; SyncToken?: string }>
  extends ToolResponse {
  output: {
    record: T
    recordId: string
    syncToken: string
    time: string | null
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
  | QuickBooksMutationResponse<QuickBooksCustomer | QuickBooksVendor | QuickBooksItem>
  | QuickBooksMutationResponse<QuickBooksSalesTransaction>
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
  DefaultTimeZone: {
    type: 'string',
    description: 'Company default time zone',
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

export const QUICKBOOKS_LIST_OUTPUTS: Record<string, OutputProperty> = {
  startPosition: {
    type: 'number',
    description: 'One-based position of the first item in this response',
  },
  maxResults: {
    type: 'number',
    description: 'Actual number of items reported for this response',
  },
  nextStartPosition: {
    type: 'number',
    description: 'Position to use when explicitly requesting the next page',
  },
  hasMore: {
    type: 'boolean',
    description: 'Conservative indication that another page may exist',
  },
  time: {
    type: 'string',
    description: 'QuickBooks response timestamp',
    optional: true,
    nullable: true,
  },
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
}

export const QUICKBOOKS_MASTER_DATA_PROPERTIES: Record<string, OutputProperty> = {
  ...QUICKBOOKS_ACCOUNT_PROPERTIES,
  ...QUICKBOOKS_CUSTOMER_PROPERTIES,
  ...QUICKBOOKS_VENDOR_PROPERTIES,
  ...QUICKBOOKS_ITEM_PROPERTIES,
  ...QUICKBOOKS_EMPLOYEE_PROPERTIES,
  Name: { type: 'string', description: 'Account or item name', optional: true },
  ParentRef: {
    type: 'json',
    description: 'Parent account, item, or category reference',
    optional: true,
    properties: QUICKBOOKS_REFERENCE_PROPERTIES,
  },
  FullyQualifiedName: {
    type: 'string',
    description: 'Hierarchical qualified account or item name',
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

export const QUICKBOOKS_MUTATION_OUTPUTS: Record<string, OutputProperty> = {
  recordId: { type: 'string', description: 'ID of the created or updated QuickBooks entity' },
  syncToken: {
    type: 'string',
    description: 'Latest sync token required for a subsequent update',
  },
  time: {
    type: 'string',
    description: 'QuickBooks response timestamp',
    optional: true,
    nullable: true,
  },
}

export const QUICKBOOKS_VOID_OUTPUTS: Record<string, OutputProperty> = {
  ...QUICKBOOKS_MUTATION_OUTPUTS,
  voided: { type: 'boolean', description: 'Whether QuickBooks voided the transaction' },
}
