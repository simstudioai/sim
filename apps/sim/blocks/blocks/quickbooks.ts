import { QuickBooksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { QuickBooksResponse } from '@/tools/quickbooks/types'

export const QuickBooksBlock: BlockConfig<QuickBooksResponse> = {
  type: 'quickbooks',
  name: 'QuickBooks',
  description: 'Manage QuickBooks Online customers, invoices, and accounting data',
  longDescription:
    'Connect to QuickBooks Online to read and write customers, invoices, and chart-of-accounts entries, or run arbitrary QuickBooks queries. Uses Intuit OAuth 2.0; the company (realmId) is captured from the OAuth callback at sign-in time.',
  authMode: AuthMode.OAuth,
  docsLink: 'https://docs.sim.ai/tools/quickbooks',
  category: 'tools',
  integrationType: IntegrationType.Other,
  tags: ['payments'],
  bgColor: '#2CA01C',
  icon: QuickBooksIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Customers', id: 'list_customers' },
        { label: 'Get Customer', id: 'get_customer' },
        { label: 'Create Customer', id: 'create_customer' },
        { label: 'Update Customer', id: 'update_customer' },
        { label: 'List Invoices', id: 'list_invoices' },
        { label: 'Get Invoice', id: 'get_invoice' },
        { label: 'Create Invoice', id: 'create_invoice' },
        { label: 'Update Invoice', id: 'update_invoice' },
        { label: 'Send Invoice', id: 'send_invoice' },
        { label: 'List Vendors', id: 'list_vendors' },
        { label: 'Get Vendor', id: 'get_vendor' },
        { label: 'Create Vendor', id: 'create_vendor' },
        { label: 'List Items', id: 'list_items' },
        { label: 'Create Item', id: 'create_item' },
        { label: 'List Payments', id: 'list_payments' },
        { label: 'Create Payment', id: 'create_payment' },
        { label: 'List Bills', id: 'list_bills' },
        { label: 'Create Bill', id: 'create_bill' },
        { label: 'List Estimates', id: 'list_estimates' },
        { label: 'List Accounts', id: 'list_accounts' },
        { label: 'Get Company Info', id: 'get_company_info' },
        { label: 'Run Query', id: 'query' },
      ],
      value: () => 'list_customers',
    },
    {
      id: 'credential',
      title: 'QuickBooks Account',
      type: 'oauth-input',
      serviceId: 'quickbooks',
      requiredScopes: getScopesForService('quickbooks'),
      placeholder: 'Select QuickBooks account',
      required: true,
    },

    // Get/create/update IDs
    {
      id: 'customerId',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'e.g. 1234',
      dependsOn: ['credential'],
      condition: {
        field: 'operation',
        value: ['get_customer', 'create_invoice', 'update_customer', 'create_payment'],
      },
      required: {
        field: 'operation',
        value: ['get_customer', 'create_invoice', 'update_customer', 'create_payment'],
      },
    },
    {
      id: 'invoiceId',
      title: 'Invoice ID',
      type: 'short-input',
      placeholder: 'e.g. 5678',
      dependsOn: ['credential'],
      condition: {
        field: 'operation',
        value: ['get_invoice', 'update_invoice', 'send_invoice'],
      },
      required: {
        field: 'operation',
        value: ['get_invoice', 'update_invoice', 'send_invoice'],
      },
    },
    {
      id: 'vendorId',
      title: 'Vendor ID',
      type: 'short-input',
      placeholder: 'e.g. 9012',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: ['get_vendor', 'create_bill'] },
      required: { field: 'operation', value: ['get_vendor', 'create_bill'] },
    },
    {
      id: 'syncToken',
      title: 'Sync Token',
      type: 'short-input',
      placeholder: '0',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: ['update_customer', 'update_invoice'] },
      required: { field: 'operation', value: ['update_customer', 'update_invoice'] },
    },

    // Create customer / update customer / create vendor (shared fields)
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Acme Corp',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer', 'create_vendor'],
      },
      required: { field: 'operation', value: ['create_customer', 'create_vendor'] },
    },
    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer', 'create_vendor'],
      },
    },
    {
      id: 'givenName',
      title: 'First Name',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer', 'create_vendor'],
      },
    },
    {
      id: 'familyName',
      title: 'Last Name',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer', 'create_vendor'],
      },
    },
    {
      id: 'primaryEmail',
      title: 'Primary Email',
      type: 'short-input',
      placeholder: 'billing@acme.com',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer', 'create_vendor'],
      },
    },
    {
      id: 'primaryPhone',
      title: 'Primary Phone',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer', 'create_vendor'],
      },
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
    },

    // Create invoice
    {
      id: 'lines',
      title: 'Line Items',
      type: 'long-input',
      placeholder: '[{"description":"Consulting","amount":1000,"quantity":1,"itemId":"1"}]',
      condition: { field: 'operation', value: 'create_invoice' },
      required: { field: 'operation', value: 'create_invoice' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of QuickBooks invoice line items. Each entry must have a numeric `amount` and may include `description`, `quantity`, `itemId`, and `itemName`. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'txnDate',
      title: 'Transaction Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_invoice', 'create_bill', 'create_payment'],
      },
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_invoice', 'update_invoice', 'create_bill'],
      },
    },
    {
      id: 'customerMemo',
      title: 'Customer Memo',
      type: 'long-input',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_invoice', 'update_invoice'] },
    },
    {
      id: 'billEmail',
      title: 'Bill Email',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_invoice', 'update_invoice'] },
    },

    // Send invoice
    {
      id: 'sendTo',
      title: 'Send To',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      condition: { field: 'operation', value: 'send_invoice' },
    },

    // Create payment
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: '100.00',
      condition: { field: 'operation', value: 'create_payment' },
      required: { field: 'operation', value: 'create_payment' },
    },
    {
      id: 'paymentInvoiceId',
      title: 'Apply to Invoice ID',
      type: 'short-input',
      placeholder: 'Optional — invoice to apply payment against',
      mode: 'advanced',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'create_payment' },
    },
    {
      id: 'paymentMethodId',
      title: 'Payment Method ID',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_payment' },
    },
    {
      id: 'paymentRefNum',
      title: 'Payment Reference Number',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_payment' },
    },

    // Create bill
    {
      id: 'billLines',
      title: 'Bill Line Items',
      type: 'long-input',
      placeholder: '[{"amount":250,"accountId":"42","description":"Office supplies"}]',
      condition: { field: 'operation', value: 'create_bill' },
      required: { field: 'operation', value: 'create_bill' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of QuickBooks bill line items. Each entry must have a numeric `amount` and a string `accountId`, and may include `description`. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },

    // Create item
    {
      id: 'itemName',
      title: 'Item Name',
      type: 'short-input',
      placeholder: 'Consulting',
      condition: { field: 'operation', value: 'create_item' },
      required: { field: 'operation', value: 'create_item' },
    },
    {
      id: 'itemType',
      title: 'Item Type',
      type: 'dropdown',
      options: [
        { label: 'Service', id: 'Service' },
        { label: 'Non-Inventory', id: 'NonInventory' },
      ],
      condition: { field: 'operation', value: 'create_item' },
      required: { field: 'operation', value: 'create_item' },
    },
    {
      id: 'incomeAccountId',
      title: 'Income Account ID',
      type: 'short-input',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'create_item' },
      required: { field: 'operation', value: 'create_item' },
    },
    {
      id: 'itemDescription',
      title: 'Item Description',
      type: 'long-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_item' },
    },
    {
      id: 'unitPrice',
      title: 'Unit Price',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_item' },
    },

    // List filters (shared across list_* operations)
    {
      id: 'where',
      title: 'WHERE Clause',
      type: 'short-input',
      placeholder: 'Active = true',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_customers',
          'list_invoices',
          'list_accounts',
          'list_vendors',
          'list_items',
          'list_payments',
          'list_bills',
          'list_estimates',
        ],
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '100',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_customers',
          'list_invoices',
          'list_accounts',
          'list_vendors',
          'list_items',
          'list_payments',
          'list_bills',
          'list_estimates',
        ],
      },
    },
    {
      id: 'startPosition',
      title: 'Start Position',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_customers',
          'list_invoices',
          'list_accounts',
          'list_vendors',
          'list_items',
          'list_payments',
          'list_bills',
          'list_estimates',
        ],
      },
    },

    // Generic query
    {
      id: 'queryStatement',
      title: 'Query',
      type: 'long-input',
      placeholder: 'SELECT * FROM Item WHERE Active = true MAXRESULTS 50',
      condition: { field: 'operation', value: 'query' },
      required: { field: 'operation', value: 'query' },
    },
  ],

  tools: {
    access: [
      'quickbooks_create_bill',
      'quickbooks_create_customer',
      'quickbooks_create_invoice',
      'quickbooks_create_item',
      'quickbooks_create_payment',
      'quickbooks_create_vendor',
      'quickbooks_get_company_info',
      'quickbooks_get_customer',
      'quickbooks_get_invoice',
      'quickbooks_get_vendor',
      'quickbooks_list_accounts',
      'quickbooks_list_bills',
      'quickbooks_list_customers',
      'quickbooks_list_estimates',
      'quickbooks_list_invoices',
      'quickbooks_list_items',
      'quickbooks_list_payments',
      'quickbooks_list_vendors',
      'quickbooks_query',
      'quickbooks_send_invoice',
      'quickbooks_update_customer',
      'quickbooks_update_invoice',
    ],
    config: {
      tool: (params) => `quickbooks_${params.operation}`,
      params: (params) => {
        const out: Record<string, unknown> = { ...params }
        if (params.maxResults !== undefined && params.maxResults !== '') {
          out.maxResults = Number(params.maxResults)
        }
        if (params.startPosition !== undefined && params.startPosition !== '') {
          out.startPosition = Number(params.startPosition)
        }
        if (params.amount !== undefined && params.amount !== '') {
          out.amount = Number(params.amount)
        }
        if (params.unitPrice !== undefined && params.unitPrice !== '') {
          out.unitPrice = Number(params.unitPrice)
        }
        if (params.billLines !== undefined) {
          out.lines = params.billLines
          out.billLines = undefined
        }
        if (params.paymentInvoiceId !== undefined) {
          out.invoiceId = params.paymentInvoiceId
          out.paymentInvoiceId = undefined
        }
        if (params.itemName !== undefined) {
          out.name = params.itemName
          out.itemName = undefined
        }
        if (params.itemType !== undefined) {
          out.type = params.itemType
          out.itemType = undefined
        }
        if (params.itemDescription !== undefined) {
          out.description = params.itemDescription
          out.itemDescription = undefined
        }
        if (params.queryStatement !== undefined) {
          out.query = params.queryStatement
          out.queryStatement = undefined
        }
        out.operation = undefined
        return out
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'QuickBooks OAuth credential' },
    customerId: { type: 'string', description: 'QuickBooks customer ID' },
    invoiceId: { type: 'string', description: 'QuickBooks invoice ID' },
    vendorId: { type: 'string', description: 'QuickBooks vendor ID' },
    syncToken: { type: 'string', description: 'SyncToken for sparse updates' },
    displayName: { type: 'string', description: 'Display name (customer or vendor)' },
    companyName: { type: 'string', description: 'Company name' },
    givenName: { type: 'string', description: 'First name' },
    familyName: { type: 'string', description: 'Last name' },
    primaryEmail: { type: 'string', description: 'Primary email' },
    primaryPhone: { type: 'string', description: 'Primary phone' },
    notes: { type: 'string', description: 'Free-form notes' },
    lines: { type: 'json', description: 'Invoice line items (JSON array)' },
    billLines: { type: 'json', description: 'Bill line items (JSON array)' },
    txnDate: { type: 'string', description: 'Transaction date (YYYY-MM-DD)' },
    dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
    customerMemo: { type: 'string', description: 'Customer-facing memo on invoice' },
    billEmail: { type: 'string', description: 'Email used for invoice billing' },
    sendTo: { type: 'string', description: 'Email recipient for send_invoice' },
    amount: { type: 'number', description: 'Payment amount' },
    paymentMethodId: { type: 'string', description: 'Payment method ID' },
    paymentRefNum: { type: 'string', description: 'Payment reference number' },
    itemName: { type: 'string', description: 'Item name' },
    itemType: { type: 'string', description: 'Item type (Service or NonInventory)' },
    incomeAccountId: { type: 'string', description: 'Income account ID for the item' },
    itemDescription: { type: 'string', description: 'Item description' },
    unitPrice: { type: 'number', description: 'Item unit price' },
    where: { type: 'string', description: 'Optional WHERE clause for list queries' },
    maxResults: { type: 'number', description: 'Maximum results returned' },
    startPosition: { type: 'number', description: 'Pagination start position (1-indexed)' },
    queryStatement: { type: 'string', description: 'QuickBooks Query Language statement' },
  },

  outputs: {
    customer: {
      type: 'json',
      description:
        'Customer record (Id, DisplayName, CompanyName, GivenName, FamilyName, PrimaryEmailAddr, PrimaryPhone, Active, Balance, CurrencyRef, Notes, MetaData, SyncToken)',
    },
    customerId: { type: 'string', description: 'Customer ID' },
    customers: {
      type: 'json',
      description:
        'Array of customer records (Id, DisplayName, CompanyName, PrimaryEmailAddr, Balance, Active, SyncToken, ...)',
    },
    invoice: {
      type: 'json',
      description:
        'Invoice record (Id, DocNumber, TxnDate, DueDate, CustomerRef, Line, TotalAmt, Balance, CurrencyRef, CustomerMemo, BillEmail, EmailStatus, MetaData, SyncToken)',
    },
    invoiceId: { type: 'string', description: 'Invoice ID' },
    invoices: {
      type: 'json',
      description:
        'Array of invoice records (Id, DocNumber, TxnDate, DueDate, CustomerRef, TotalAmt, Balance, EmailStatus, SyncToken, ...)',
    },
    accounts: {
      type: 'json',
      description:
        'Array of account records (Id, Name, AccountType, AccountSubType, Classification, CurrentBalance, Active, CurrencyRef, SyncToken)',
    },
    vendor: {
      type: 'json',
      description:
        'Vendor record (Id, DisplayName, CompanyName, GivenName, FamilyName, PrimaryEmailAddr, PrimaryPhone, Active, Balance, CurrencyRef, MetaData, SyncToken)',
    },
    vendorId: { type: 'string', description: 'Vendor ID' },
    vendors: {
      type: 'json',
      description:
        'Array of vendor records (Id, DisplayName, CompanyName, PrimaryEmailAddr, Balance, Active, SyncToken, ...)',
    },
    item: {
      type: 'json',
      description:
        'Item record (Id, Name, Description, Type, Active, UnitPrice, IncomeAccountRef, ExpenseAccountRef, AssetAccountRef, QtyOnHand, MetaData, SyncToken)',
    },
    itemId: { type: 'string', description: 'Item ID' },
    items: {
      type: 'json',
      description:
        'Array of item records (Id, Name, Type, UnitPrice, Active, IncomeAccountRef, SyncToken, ...)',
    },
    payment: {
      type: 'json',
      description:
        'Payment record (Id, TxnDate, CustomerRef, TotalAmt, UnappliedAmt, PaymentMethodRef, PaymentRefNum, Line, CurrencyRef, MetaData, SyncToken)',
    },
    paymentId: { type: 'string', description: 'Payment ID' },
    payments: {
      type: 'json',
      description:
        'Array of payment records (Id, TxnDate, CustomerRef, TotalAmt, UnappliedAmt, PaymentRefNum, SyncToken, ...)',
    },
    bill: {
      type: 'json',
      description:
        'Bill record (Id, VendorRef, TxnDate, DueDate, TotalAmt, Balance, Line, CurrencyRef, MetaData, SyncToken)',
    },
    billId: { type: 'string', description: 'Bill ID' },
    bills: {
      type: 'json',
      description:
        'Array of bill records (Id, VendorRef, TxnDate, DueDate, TotalAmt, Balance, SyncToken, ...)',
    },
    estimates: {
      type: 'json',
      description:
        'Array of estimate records (Id, DocNumber, TxnDate, ExpirationDate, CustomerRef, Line, TotalAmt, TxnStatus, EmailStatus, SyncToken, ...)',
    },
    companyInfo: {
      type: 'json',
      description:
        'Company info (Id, CompanyName, LegalName, CompanyAddr, CompanyStartDate, FiscalYearStartMonth, Country, Email, WebAddr, SupportedLanguages, NameValue, MetaData)',
    },
    results: {
      type: 'json',
      description:
        'Raw QueryResponse object for the query operation (entity arrays keyed by entity name, plus startPosition/maxResults/totalCount)',
    },
    totalCount: { type: 'number', description: 'Number of records returned' },
  },
}
