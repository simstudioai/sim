import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface QuickBooksBaseParams {
  accessToken: string
  realmId: string
}

export interface QuickBooksListParams extends QuickBooksBaseParams {
  maxResults?: number
  startPosition?: number
  where?: string
}

export interface QuickBooksGetCustomerParams extends QuickBooksBaseParams {
  customerId: string
}

export interface QuickBooksCreateCustomerParams extends QuickBooksBaseParams {
  displayName: string
  companyName?: string
  givenName?: string
  familyName?: string
  primaryEmail?: string
  primaryPhone?: string
  notes?: string
}

export interface QuickBooksGetInvoiceParams extends QuickBooksBaseParams {
  invoiceId: string
}

export interface QuickBooksLineItem {
  description?: string
  amount: number
  quantity?: number
  itemId?: string
  itemName?: string
}

export interface QuickBooksCreateInvoiceParams extends QuickBooksBaseParams {
  customerId: string
  lines: QuickBooksLineItem[] | string
  dueDate?: string
  txnDate?: string
  customerMemo?: string
  billEmail?: string
}

export interface QuickBooksQueryParams extends QuickBooksBaseParams {
  query: string
}

export interface QuickBooksResponse extends ToolResponse {
  output: Record<string, unknown>
}

export interface QuickBooksCustomerResponse extends ToolResponse {
  output: {
    customer: Record<string, unknown> | null
    customerId: string | null
  }
}

export interface QuickBooksCustomerListResponse extends ToolResponse {
  output: {
    customers: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksInvoiceResponse extends ToolResponse {
  output: {
    invoice: Record<string, unknown> | null
    invoiceId: string | null
  }
}

export interface QuickBooksInvoiceListResponse extends ToolResponse {
  output: {
    invoices: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksAccountListResponse extends ToolResponse {
  output: {
    accounts: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksQueryResponse extends ToolResponse {
  output: {
    results: Record<string, unknown>
    totalCount: number
  }
}

/**
 * Common Customer fields returned by the QuickBooks Online accounting API.
 * @see https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
 */
export const CUSTOMER_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks customer ID' },
  DisplayName: { type: 'string', description: 'Display name shown in lists and forms' },
  CompanyName: { type: 'string', description: 'Company name' },
  GivenName: { type: 'string', description: 'First name' },
  FamilyName: { type: 'string', description: 'Last name' },
  PrimaryEmailAddr: { type: 'object', description: 'Primary email object with `Address`' },
  PrimaryPhone: { type: 'object', description: 'Primary phone object with `FreeFormNumber`' },
  Active: { type: 'boolean', description: 'Whether the customer is active' },
  Balance: { type: 'number', description: 'Open balance owed by the customer' },
  CurrencyRef: { type: 'object', description: 'Currency reference (`value`, `name`)' },
  Notes: { type: 'string', description: 'Free-form notes' },
  MetaData: { type: 'object', description: 'Create/update timestamps' },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INVOICE_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks invoice ID' },
  DocNumber: { type: 'string', description: 'Invoice document number' },
  TxnDate: { type: 'string', description: 'Invoice transaction date (YYYY-MM-DD)' },
  DueDate: { type: 'string', description: 'Invoice due date (YYYY-MM-DD)' },
  CustomerRef: { type: 'object', description: 'Reference to the customer (`value`, `name`)' },
  Line: { type: 'array', description: 'Invoice line items' },
  TotalAmt: { type: 'number', description: 'Total amount of the invoice' },
  Balance: { type: 'number', description: 'Outstanding balance on the invoice' },
  CurrencyRef: { type: 'object', description: 'Currency reference' },
  CustomerMemo: { type: 'object', description: 'Customer-facing memo' },
  BillEmail: { type: 'object', description: 'Billing email object' },
  EmailStatus: { type: 'string', description: 'Email send status (NotSet, NeedToSend, EmailSent)' },
  MetaData: { type: 'object', description: 'Create/update timestamps' },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ACCOUNT_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks account ID' },
  Name: { type: 'string', description: 'Account name' },
  AccountType: { type: 'string', description: 'High-level account type (Income, Expense, etc.)' },
  AccountSubType: { type: 'string', description: 'Account sub-type' },
  Classification: { type: 'string', description: 'Asset, Liability, Equity, Revenue, or Expense' },
  CurrentBalance: { type: 'number', description: 'Current account balance' },
  Active: { type: 'boolean', description: 'Whether the account is active' },
  CurrencyRef: { type: 'object', description: 'Currency reference' },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface QuickBooksGetVendorParams extends QuickBooksBaseParams {
  vendorId: string
}

export interface QuickBooksCreateVendorParams extends QuickBooksBaseParams {
  displayName: string
  companyName?: string
  givenName?: string
  familyName?: string
  primaryEmail?: string
  primaryPhone?: string
}

export interface QuickBooksVendorResponse extends ToolResponse {
  output: {
    vendor: Record<string, unknown> | null
    vendorId: string | null
  }
}

export interface QuickBooksVendorListResponse extends ToolResponse {
  output: {
    vendors: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksGetItemParams extends QuickBooksBaseParams {
  itemId: string
}

export interface QuickBooksCreateItemParams extends QuickBooksBaseParams {
  name: string
  type: string
  incomeAccountId: string
  description?: string
  unitPrice?: number
}

export interface QuickBooksItemResponse extends ToolResponse {
  output: {
    item: Record<string, unknown> | null
    itemId: string | null
  }
}

export interface QuickBooksItemListResponse extends ToolResponse {
  output: {
    items: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksGetPaymentParams extends QuickBooksBaseParams {
  paymentId: string
}

export interface QuickBooksCreatePaymentParams extends QuickBooksBaseParams {
  customerId: string
  amount: number
  invoiceId?: string
  paymentMethodId?: string
  txnDate?: string
  paymentRefNum?: string
}

export interface QuickBooksPaymentResponse extends ToolResponse {
  output: {
    payment: Record<string, unknown> | null
    paymentId: string | null
  }
}

export interface QuickBooksPaymentListResponse extends ToolResponse {
  output: {
    payments: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksGetBillParams extends QuickBooksBaseParams {
  billId: string
}

export interface QuickBooksBillLine {
  amount: number
  accountId: string
  description?: string
}

export interface QuickBooksCreateBillParams extends QuickBooksBaseParams {
  vendorId: string
  lines: QuickBooksBillLine[] | string
  txnDate?: string
  dueDate?: string
}

export interface QuickBooksBillResponse extends ToolResponse {
  output: {
    bill: Record<string, unknown> | null
    billId: string | null
  }
}

export interface QuickBooksBillListResponse extends ToolResponse {
  output: {
    bills: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksEstimateListResponse extends ToolResponse {
  output: {
    estimates: Record<string, unknown>[]
    totalCount: number
  }
}

export interface QuickBooksUpdateCustomerParams extends QuickBooksBaseParams {
  customerId: string
  syncToken: string
  displayName?: string
  companyName?: string
  givenName?: string
  familyName?: string
  primaryEmail?: string
  primaryPhone?: string
  notes?: string
}

export interface QuickBooksUpdateInvoiceParams extends QuickBooksBaseParams {
  invoiceId: string
  syncToken: string
  dueDate?: string
  customerMemo?: string
  billEmail?: string
}

export interface QuickBooksSendInvoiceParams extends QuickBooksBaseParams {
  invoiceId: string
  sendTo?: string
}

export interface QuickBooksCompanyInfoResponse extends ToolResponse {
  output: {
    companyInfo: Record<string, unknown> | null
  }
}

export const VENDOR_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks vendor ID' },
  DisplayName: { type: 'string', description: 'Display name', optional: true },
  CompanyName: { type: 'string', description: 'Company name', optional: true },
  GivenName: { type: 'string', description: 'First name', optional: true },
  FamilyName: { type: 'string', description: 'Last name', optional: true },
  PrimaryEmailAddr: {
    type: 'object',
    description: 'Primary email object with `Address`',
    optional: true,
  },
  PrimaryPhone: {
    type: 'object',
    description: 'Primary phone object with `FreeFormNumber`',
    optional: true,
  },
  Active: { type: 'boolean', description: 'Whether the vendor is active', optional: true },
  Balance: { type: 'number', description: 'Open balance owed to the vendor', optional: true },
  CurrencyRef: { type: 'object', description: 'Currency reference', optional: true },
  MetaData: { type: 'object', description: 'Create/update timestamps', optional: true },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ITEM_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks item ID' },
  Name: { type: 'string', description: 'Item name', optional: true },
  Description: { type: 'string', description: 'Item description', optional: true },
  Type: {
    type: 'string',
    description: 'Item type (Service, Inventory, NonInventory)',
    optional: true,
  },
  Active: { type: 'boolean', description: 'Whether the item is active', optional: true },
  UnitPrice: { type: 'number', description: 'Unit price', optional: true },
  IncomeAccountRef: { type: 'object', description: 'Income account reference', optional: true },
  ExpenseAccountRef: { type: 'object', description: 'Expense account reference', optional: true },
  AssetAccountRef: { type: 'object', description: 'Asset account reference', optional: true },
  QtyOnHand: { type: 'number', description: 'Quantity on hand (Inventory only)', optional: true },
  MetaData: { type: 'object', description: 'Create/update timestamps', optional: true },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PAYMENT_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks payment ID' },
  TxnDate: { type: 'string', description: 'Transaction date (YYYY-MM-DD)', optional: true },
  CustomerRef: { type: 'object', description: 'Customer reference', optional: true },
  TotalAmt: { type: 'number', description: 'Total payment amount', optional: true },
  UnappliedAmt: { type: 'number', description: 'Unapplied amount', optional: true },
  PaymentMethodRef: { type: 'object', description: 'Payment method reference', optional: true },
  PaymentRefNum: { type: 'string', description: 'Payment reference number', optional: true },
  Line: { type: 'array', description: 'Payment line items / linked transactions', optional: true },
  CurrencyRef: { type: 'object', description: 'Currency reference', optional: true },
  MetaData: { type: 'object', description: 'Create/update timestamps', optional: true },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const BILL_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks bill ID' },
  VendorRef: { type: 'object', description: 'Vendor reference', optional: true },
  TxnDate: { type: 'string', description: 'Transaction date (YYYY-MM-DD)', optional: true },
  DueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)', optional: true },
  TotalAmt: { type: 'number', description: 'Total bill amount', optional: true },
  Balance: { type: 'number', description: 'Outstanding balance', optional: true },
  Line: { type: 'array', description: 'Bill line items', optional: true },
  CurrencyRef: { type: 'object', description: 'Currency reference', optional: true },
  MetaData: { type: 'object', description: 'Create/update timestamps', optional: true },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ESTIMATE_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks estimate ID' },
  DocNumber: { type: 'string', description: 'Estimate document number', optional: true },
  TxnDate: { type: 'string', description: 'Transaction date (YYYY-MM-DD)', optional: true },
  ExpirationDate: { type: 'string', description: 'Expiration date (YYYY-MM-DD)', optional: true },
  CustomerRef: { type: 'object', description: 'Customer reference', optional: true },
  Line: { type: 'array', description: 'Estimate line items', optional: true },
  TotalAmt: { type: 'number', description: 'Total estimate amount', optional: true },
  TxnStatus: {
    type: 'string',
    description: 'Estimate status (Pending, Accepted, etc.)',
    optional: true,
  },
  EmailStatus: { type: 'string', description: 'Email send status', optional: true },
  MetaData: { type: 'object', description: 'Create/update timestamps', optional: true },
  SyncToken: {
    type: 'string',
    description: 'Optimistic concurrency token; required for sparse updates',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const COMPANY_INFO_OUTPUT: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'QuickBooks company ID (realmId)' },
  CompanyName: { type: 'string', description: 'Company name', optional: true },
  LegalName: { type: 'string', description: 'Legal name', optional: true },
  CompanyAddr: { type: 'object', description: 'Company address', optional: true },
  CompanyStartDate: { type: 'string', description: 'Company start date', optional: true },
  FiscalYearStartMonth: { type: 'string', description: 'Fiscal year start month', optional: true },
  Country: { type: 'string', description: 'Country code', optional: true },
  Email: { type: 'object', description: 'Primary email object', optional: true },
  WebAddr: { type: 'object', description: 'Web address', optional: true },
  SupportedLanguages: { type: 'string', description: 'Supported languages', optional: true },
  NameValue: { type: 'array', description: 'Custom name/value pairs', optional: true },
  MetaData: { type: 'object', description: 'Create/update timestamps', optional: true },
} as const satisfies Record<string, OutputProperty>
