import type { ToolResponse } from '@/tools/types'

/**
 * QuickBooks metadata type for custom key-value pairs
 */
export interface QuickBooksMetadata {
  [key: string]: string
}

/**
 * QuickBooks address structure
 */
export interface QuickBooksAddress {
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

/**
 * QuickBooks reference type for linking entities
 */
export interface QuickBooksRef {
  value: string
  name?: string
}

/**
 * QuickBooks line item for invoices and expenses
 */
export interface QuickBooksLineItem {
  Id?: string
  LineNum?: number
  Description?: string
  Amount: number
  DetailType: 'SalesItemLineDetail' | 'DescriptionOnly' | 'AccountBasedExpenseLineDetail'
  SalesItemLineDetail?: {
    ItemRef?: QuickBooksRef
    UnitPrice?: number
    Qty?: number
    TaxCodeRef?: QuickBooksRef
  }
  AccountBasedExpenseLineDetail?: {
    AccountRef: QuickBooksRef
    TaxCodeRef?: QuickBooksRef
  }
}

/**
 * Invoice Types
 */
export interface InvoiceObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  CustomField?: Array<{ DefinitionId: string; Name: string; Type: string; StringValue?: string }>
  DocNumber?: string
  TxnDate: string
  CurrencyRef?: QuickBooksRef
  Line: QuickBooksLineItem[]
  CustomerRef: QuickBooksRef
  BillAddr?: QuickBooksAddress
  ShipAddr?: QuickBooksAddress
  TotalAmt: number
  Balance: number
  DueDate?: string
  EmailStatus?: 'NotSet' | 'NeedToSend' | 'EmailSent'
  BillEmail?: { Address: string }
  TxnStatus?: string
  [key: string]: any
}

export interface CreateInvoiceParams {
  apiKey: string
  realmId: string
  CustomerRef: QuickBooksRef
  Line: QuickBooksLineItem[]
  TxnDate?: string
  DueDate?: string
  DocNumber?: string
  BillEmail?: { Address: string }
  BillAddr?: QuickBooksAddress
  ShipAddr?: QuickBooksAddress
  CustomField?: Array<{ DefinitionId: string; Name: string; Type: string; StringValue?: string }>
}

export interface InvoiceResponse extends ToolResponse {
  output: {
    invoice: InvoiceObject
    metadata: {
      Id: string
      DocNumber: string
      TotalAmt: number
      Balance: number
      TxnDate: string
    }
  }
}

export interface UpdateInvoiceParams {
  apiKey: string
  realmId: string
  Id: string
  SyncToken: string
  sparse?: boolean
  Line?: QuickBooksLineItem[]
  CustomerRef?: QuickBooksRef
  TxnDate?: string
  DueDate?: string
  EmailStatus?: 'NotSet' | 'NeedToSend' | 'EmailSent'
}

export interface ListInvoicesParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
  startPosition?: number
}

export interface ListInvoicesResponse extends ToolResponse {
  output: {
    invoices: InvoiceObject[]
    metadata: {
      count: number
      startPosition: number
      maxResults: number
    }
  }
}

export interface RetrieveInvoiceParams {
  apiKey: string
  realmId: string
  Id: string
}

export interface SendInvoiceParams {
  apiKey: string
  realmId: string
  Id: string
  sendTo?: string
}

export interface DeleteInvoiceParams {
  apiKey: string
  realmId: string
  Id: string
  SyncToken: string
}

/**
 * Customer Types
 */
export interface CustomerObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  DisplayName: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryPhone?: { FreeFormNumber: string }
  PrimaryEmailAddr?: { Address: string }
  BillAddr?: QuickBooksAddress
  ShipAddr?: QuickBooksAddress
  Balance?: number
  BalanceWithJobs?: number
  Active?: boolean
  Taxable?: boolean
  PreferredDeliveryMethod?: string
  [key: string]: any
}

export interface CreateCustomerParams {
  apiKey: string
  realmId: string
  DisplayName: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryPhone?: { FreeFormNumber: string }
  PrimaryEmailAddr?: { Address: string }
  BillAddr?: QuickBooksAddress
  ShipAddr?: QuickBooksAddress
  Taxable?: boolean
  PreferredDeliveryMethod?: string
}

export interface CustomerResponse extends ToolResponse {
  output: {
    customer: CustomerObject
    metadata: {
      Id: string
      DisplayName: string
      Balance: number
    }
  }
}

export interface UpdateCustomerParams {
  apiKey: string
  realmId: string
  Id: string
  SyncToken: string
  sparse?: boolean
  DisplayName?: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryPhone?: { FreeFormNumber: string }
  PrimaryEmailAddr?: { Address: string }
  BillAddr?: QuickBooksAddress
  Active?: boolean
}

export interface ListCustomersParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
  startPosition?: number
}

export interface ListCustomersResponse extends ToolResponse {
  output: {
    customers: CustomerObject[]
    metadata: {
      count: number
      startPosition: number
      maxResults: number
    }
  }
}

export interface RetrieveCustomerParams {
  apiKey: string
  realmId: string
  Id: string
}

/**
 * Expense Types
 */
export interface ExpenseObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  TxnDate: string
  AccountRef: QuickBooksRef
  PaymentType: 'Cash' | 'Check' | 'CreditCard'
  EntityRef?: QuickBooksRef
  Line: QuickBooksLineItem[]
  TotalAmt: number
  DocNumber?: string
  PrivateNote?: string
  [key: string]: any
}

export interface CreateExpenseParams {
  apiKey: string
  realmId: string
  AccountRef: QuickBooksRef
  Line: QuickBooksLineItem[]
  TxnDate?: string
  PaymentType: 'Cash' | 'Check' | 'CreditCard'
  EntityRef?: QuickBooksRef
  DocNumber?: string
  PrivateNote?: string
}

export interface ExpenseResponse extends ToolResponse {
  output: {
    expense: ExpenseObject
    metadata: {
      Id: string
      TotalAmt: number
      TxnDate: string
      PaymentType: string
    }
  }
}

export interface UpdateExpenseParams {
  apiKey: string
  realmId: string
  Id: string
  SyncToken: string
  sparse?: boolean
  AccountRef?: QuickBooksRef
  Line?: QuickBooksLineItem[]
  TxnDate?: string
  PaymentType?: 'Cash' | 'Check' | 'CreditCard'
}

export interface ListExpensesParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
  startPosition?: number
}

export interface ListExpensesResponse extends ToolResponse {
  output: {
    expenses: ExpenseObject[]
    metadata: {
      count: number
      startPosition: number
      maxResults: number
    }
  }
}

export interface RetrieveExpenseParams {
  apiKey: string
  realmId: string
  Id: string
}

/**
 * Payment Types
 */
export interface PaymentObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  TxnDate: string
  CustomerRef: QuickBooksRef
  TotalAmt: number
  UnappliedAmt?: number
  Line?: Array<{
    Amount: number
    LinkedTxn: Array<{
      TxnId: string
      TxnType: string
    }>
  }>
  [key: string]: any
}

export interface CreatePaymentParams {
  apiKey: string
  realmId: string
  CustomerRef: QuickBooksRef
  TotalAmt: number
  TxnDate?: string
  Line?: Array<{
    Amount: number
    LinkedTxn: Array<{
      TxnId: string
      TxnType: string
    }>
  }>
}

export interface PaymentResponse extends ToolResponse {
  output: {
    payment: PaymentObject
    metadata: {
      Id: string
      TotalAmt: number
      TxnDate: string
    }
  }
}

/**
 * Account Types
 */
export interface AccountObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  Name: string
  AccountType: string
  AccountSubType: string
  CurrentBalance?: number
  Active?: boolean
  Classification?: string
  [key: string]: any
}

export interface ListAccountsParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
}

export interface ListAccountsResponse extends ToolResponse {
  output: {
    accounts: AccountObject[]
    metadata: {
      count: number
    }
  }
}

/**
 * Item Types
 */
export interface ItemObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  Name: string
  Type: 'Inventory' | 'NonInventory' | 'Service'
  UnitPrice?: number
  QtyOnHand?: number
  IncomeAccountRef?: QuickBooksRef
  ExpenseAccountRef?: QuickBooksRef
  Active?: boolean
  [key: string]: any
}

export interface CreateItemParams {
  apiKey: string
  realmId: string
  Name: string
  Type: 'Inventory' | 'NonInventory' | 'Service'
  UnitPrice?: number
  IncomeAccountRef?: QuickBooksRef
  ExpenseAccountRef?: QuickBooksRef
}

export interface ItemResponse extends ToolResponse {
  output: {
    item: ItemObject
    metadata: {
      Id: string
      Name: string
      Type: string
    }
  }
}

export interface ListItemsParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
}

export interface ListItemsResponse extends ToolResponse {
  output: {
    items: ItemObject[]
    metadata: {
      count: number
    }
  }
}

/**
 * Bill Types
 */
export interface BillObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  TxnDate: string
  VendorRef: QuickBooksRef
  Line: QuickBooksLineItem[]
  TotalAmt: number
  Balance: number
  DueDate?: string
  DocNumber?: string
  PrivateNote?: string
  [key: string]: any
}

export interface CreateBillParams {
  apiKey: string
  realmId: string
  VendorRef: QuickBooksRef
  Line: QuickBooksLineItem[]
  TxnDate?: string
  DueDate?: string
  DocNumber?: string
  PrivateNote?: string
}

export interface BillResponse extends ToolResponse {
  output: {
    bill: BillObject
    metadata: {
      Id: string
      DocNumber: string
      TotalAmt: number
      Balance: number
      TxnDate: string
      DueDate?: string
    }
  }
}

export interface ListBillsParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
  startPosition?: number
}

export interface ListBillsResponse extends ToolResponse {
  output: {
    bills: BillObject[]
    metadata: {
      count: number
      startPosition: number
      maxResults: number
    }
  }
}

export interface RetrieveBillParams {
  apiKey: string
  realmId: string
  Id: string
}

export interface CreateBillPaymentParams {
  apiKey: string
  realmId: string
  VendorRef: QuickBooksRef
  TotalAmt: number
  APAccountRef: QuickBooksRef
  PayType?: string
  TxnDate?: string
  Line?: any[]
}

export interface BillPaymentResponse extends ToolResponse {
  output: {
    billPayment: any
    metadata: {
      Id: string
      TotalAmt: number
      TxnDate: string
      PayType: string
    }
  }
}

export interface ListPaymentsParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
  startPosition?: number
}

export interface ListPaymentsResponse extends ToolResponse {
  output: {
    payments: PaymentObject[]
    metadata: {
      count: number
      startPosition: number
      maxResults: number
    }
  }
}

/**
 * Report Types
 */
export interface GetProfitLossParams {
  apiKey: string
  realmId: string
  start_date?: string
  end_date?: string
  accounting_method?: string
  summarize_column_by?: string
}

export interface ProfitLossResponse extends ToolResponse {
  output: {
    report: any
    metadata: {
      ReportName: string
      StartPeriod: string
      EndPeriod: string
      Currency: string
    }
  }
}

export interface GetBalanceSheetParams {
  apiKey: string
  realmId: string
  date?: string
  accounting_method?: string
}

export interface BalanceSheetResponse extends ToolResponse {
  output: {
    report: any
    metadata: {
      ReportName: string
      ReportDate: string
      Currency: string
    }
  }
}

export interface GetCashFlowParams {
  apiKey: string
  realmId: string
  start_date?: string
  end_date?: string
  accounting_method?: string
}

export interface CashFlowResponse extends ToolResponse {
  output: {
    report: any
    metadata: {
      ReportName: string
      StartPeriod: string
      EndPeriod: string
      Currency: string
    }
  }
}

/**
 * Reconciliation Types
 */
export interface ReconcileBankTransactionParams {
  apiKey: string
  realmId: string
  bankTransactionId: string
  matchType: string
  matchedTransactionId: string
  confidence?: number
}

export interface ReconcileResponse extends ToolResponse {
  output: {
    reconciliation: any
    metadata: {
      bankTransactionId: string
      matchedTransactionId: string
      matchType: string
      status: string
    }
  }
}

export interface CategorizeTransactionParams {
  apiKey: string
  realmId: string
  transactionId: string
  merchantName: string
  description?: string
  amount: number
  historicalCategories?: any[]
  useAI?: boolean
}

export interface CategorizeResponse extends ToolResponse {
  output: {
    transaction: any
    suggestion: {
      category: string
      subcategory: string
      confidence: number
      reasoning: string
    }
    metadata: {
      transactionId: string
      merchantName: string
      amount: number
    }
  }
}

/**
 * Vendor Types
 */
export interface VendorObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  DisplayName: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryPhone?: { FreeFormNumber: string }
  PrimaryEmailAddr?: { Address: string }
  BillAddr?: QuickBooksAddress
  Balance?: number
  Vendor1099?: boolean
  Active?: boolean
  [key: string]: any
}

export interface CreateVendorParams {
  apiKey: string
  realmId: string
  DisplayName: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryPhone?: { FreeFormNumber: string }
  PrimaryEmailAddr?: { Address: string }
  BillAddr?: QuickBooksAddress
  Vendor1099?: boolean
}

export interface VendorResponse extends ToolResponse {
  output: {
    vendor: VendorObject
    metadata: {
      Id: string
      DisplayName: string
      Balance: number
      Vendor1099: boolean
    }
  }
}

export interface ListVendorsParams {
  apiKey: string
  realmId: string
  query?: string
  maxResults?: number
  startPosition?: number
}

export interface ListVendorsResponse extends ToolResponse {
  output: {
    vendors: VendorObject[]
    metadata: {
      count: number
      startPosition: number
      maxResults: number
    }
  }
}

export interface RetrieveVendorParams {
  apiKey: string
  realmId: string
  Id: string
}

/**
 * Estimate Types
 */
export interface EstimateObject {
  Id: string
  SyncToken: string
  MetaData: {
    CreateTime: string
    LastUpdatedTime: string
  }
  DocNumber?: string
  TxnDate: string
  CustomerRef: QuickBooksRef
  Line: QuickBooksLineItem[]
  TotalAmt: number
  ExpirationDate?: string
  BillEmail?: { Address: string }
  [key: string]: any
}

export interface CreateEstimateParams {
  apiKey: string
  realmId: string
  CustomerRef: QuickBooksRef
  Line: QuickBooksLineItem[]
  TxnDate?: string
  ExpirationDate?: string
  DocNumber?: string
  BillEmail?: { Address: string }
}

export interface EstimateResponse extends ToolResponse {
  output: {
    estimate: EstimateObject
    metadata: {
      Id: string
      DocNumber: string
      TotalAmt: number
      TxnDate: string
      ExpirationDate?: string
    }
  }
}
