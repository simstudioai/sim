import { QuickBooksIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { InvoiceResponse } from '@/tools/quickbooks/types'

export const QuickBooksBlock: BlockConfig<InvoiceResponse> = {
  type: 'quickbooks',
  name: 'QuickBooks',
  description: 'Manage accounting data in QuickBooks Online',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrates QuickBooks Online into the workflow. Manage invoices, customers, expenses, payments, accounts, and items. Automate accounting tasks and sync financial data.',
  docsLink: 'https://docs.sim.ai/tools/quickbooks',
  category: 'tools',
  bgColor: '#2CA01C',
  icon: QuickBooksIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Invoices
        { label: 'Create Invoice', id: 'create_invoice' },
        { label: 'Retrieve Invoice', id: 'retrieve_invoice' },
        { label: 'List Invoices', id: 'list_invoices' },
        // Customers
        { label: 'Create Customer', id: 'create_customer' },
        { label: 'Retrieve Customer', id: 'retrieve_customer' },
        { label: 'List Customers', id: 'list_customers' },
        // Expenses
        { label: 'Create Expense', id: 'create_expense' },
        { label: 'Retrieve Expense', id: 'retrieve_expense' },
        { label: 'List Expenses', id: 'list_expenses' },
      ],
      value: () => 'list_invoices',
    },
    {
      id: 'apiKey',
      title: 'QuickBooks Access Token',
      type: 'short-input',
      password: true,
      placeholder: 'OAuth access token from QuickBooks connection',
      required: true,
    },
    {
      id: 'realmId',
      title: 'Realm ID (Company ID)',
      type: 'short-input',
      placeholder: 'QuickBooks company/realm ID',
      required: true,
    },
    // Common ID field for retrieve operations
    {
      id: 'Id',
      title: 'ID',
      type: 'short-input',
      placeholder: 'Enter the resource ID',
      condition: {
        field: 'operation',
        value: ['retrieve_invoice', 'retrieve_customer', 'retrieve_expense'],
      },
      required: true,
    },
    // Invoice fields - CustomerRef REQUIRED for create_invoice
    {
      id: 'CustomerRef',
      title: 'Customer Reference (JSON)',
      type: 'code',
      placeholder: '{"value": "123", "name": "Customer Name"}',
      condition: {
        field: 'operation',
        value: 'create_invoice',
      },
      required: true,
    },
    // Line items - REQUIRED for create operations
    {
      id: 'Line',
      title: 'Line Items (JSON Array)',
      type: 'code',
      placeholder:
        '[{"Amount": 100, "DetailType": "SalesItemLineDetail", "Description": "Item description"}]',
      condition: {
        field: 'operation',
        value: ['create_invoice', 'create_expense'],
      },
      required: true,
    },
    // Invoice dates
    {
      id: 'TxnDate',
      title: 'Transaction Date (YYYY-MM-DD)',
      type: 'short-input',
      placeholder: 'e.g., 2024-01-15',
      condition: {
        field: 'operation',
        value: ['create_invoice', 'create_expense'],
      },
    },
    {
      id: 'DueDate',
      title: 'Due Date (YYYY-MM-DD)',
      type: 'short-input',
      placeholder: 'e.g., 2024-02-15',
      condition: {
        field: 'operation',
        value: 'create_invoice',
      },
    },
    {
      id: 'DocNumber',
      title: 'Document Number',
      type: 'short-input',
      placeholder: 'Invoice or check number',
      condition: {
        field: 'operation',
        value: ['create_invoice', 'create_expense'],
      },
    },
    {
      id: 'BillEmail',
      title: 'Billing Email (JSON)',
      type: 'code',
      placeholder: '{"Address": "customer@example.com"}',
      condition: {
        field: 'operation',
        value: 'create_invoice',
      },
    },
    // Customer fields - DisplayName REQUIRED for create_customer
    {
      id: 'DisplayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Customer display name (must be unique)',
      condition: {
        field: 'operation',
        value: 'create_customer',
      },
      required: true,
    },
    {
      id: 'CompanyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Company name',
      condition: {
        field: 'operation',
        value: 'create_customer',
      },
    },
    {
      id: 'GivenName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Customer first name',
      condition: {
        field: 'operation',
        value: 'create_customer',
      },
    },
    {
      id: 'FamilyName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Customer last name',
      condition: {
        field: 'operation',
        value: 'create_customer',
      },
    },
    {
      id: 'PrimaryEmailAddr',
      title: 'Primary Email (JSON)',
      type: 'code',
      placeholder: '{"Address": "customer@example.com"}',
      condition: {
        field: 'operation',
        value: 'create_customer',
      },
    },
    {
      id: 'PrimaryPhone',
      title: 'Primary Phone (JSON)',
      type: 'code',
      placeholder: '{"FreeFormNumber": "555-1234"}',
      condition: {
        field: 'operation',
        value: 'create_customer',
      },
    },
    // Expense fields - AccountRef REQUIRED for create_expense
    {
      id: 'AccountRef',
      title: 'Account Reference (JSON)',
      type: 'code',
      placeholder: '{"value": "35", "name": "Bank Account"}',
      condition: {
        field: 'operation',
        value: 'create_expense',
      },
      required: true,
    },
    {
      id: 'PaymentType',
      title: 'Payment Type',
      type: 'dropdown',
      options: [
        { label: 'Cash', id: 'Cash' },
        { label: 'Check', id: 'Check' },
        { label: 'Credit Card', id: 'CreditCard' },
      ],
      condition: {
        field: 'operation',
        value: 'create_expense',
      },
      required: true,
    },
    {
      id: 'EntityRef',
      title: 'Entity Reference (JSON)',
      type: 'code',
      placeholder: '{"value": "123", "name": "Vendor Name"}',
      condition: {
        field: 'operation',
        value: 'create_expense',
      },
    },
    {
      id: 'PrivateNote',
      title: 'Private Note',
      type: 'long-input',
      placeholder: 'Internal note for the expense',
      condition: {
        field: 'operation',
        value: 'create_expense',
      },
    },
    // List/Query fields
    {
      id: 'query',
      title: 'SQL Query',
      type: 'long-input',
      placeholder: 'e.g., SELECT * FROM Invoice WHERE Balance > 0 ORDER BY TxnDate DESC',
      condition: {
        field: 'operation',
        value: ['list_invoices', 'list_customers', 'list_expenses'],
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Default: 100',
      condition: {
        field: 'operation',
        value: ['list_invoices', 'list_customers', 'list_expenses'],
      },
    },
    {
      id: 'startPosition',
      title: 'Start Position',
      type: 'short-input',
      placeholder: 'Pagination offset (default: 1)',
      condition: {
        field: 'operation',
        value: ['list_invoices', 'list_customers', 'list_expenses'],
      },
    },
  ],
  tools: {
    access: [
      // Invoices
      'quickbooks_create_invoice',
      'quickbooks_retrieve_invoice',
      'quickbooks_list_invoices',
      // Customers
      'quickbooks_create_customer',
      'quickbooks_retrieve_customer',
      'quickbooks_list_customers',
      // Expenses
      'quickbooks_create_expense',
      'quickbooks_retrieve_expense',
      'quickbooks_list_expenses',
    ],
    config: {
      tool: (params) => {
        return `quickbooks_${params.operation}`
      },
      params: (params) => {
        const {
          operation,
          apiKey,
          realmId,
          CustomerRef,
          Line,
          BillEmail,
          PrimaryEmailAddr,
          PrimaryPhone,
          AccountRef,
          EntityRef,
          ...rest
        } = params

        // Parse JSON fields
        let parsedCustomerRef: any | undefined
        let parsedLine: any | undefined
        let parsedBillEmail: any | undefined
        let parsedPrimaryEmailAddr: any | undefined
        let parsedPrimaryPhone: any | undefined
        let parsedAccountRef: any | undefined
        let parsedEntityRef: any | undefined

        try {
          if (CustomerRef) parsedCustomerRef = JSON.parse(CustomerRef)
          if (Line) parsedLine = JSON.parse(Line)
          if (BillEmail) parsedBillEmail = JSON.parse(BillEmail)
          if (PrimaryEmailAddr) parsedPrimaryEmailAddr = JSON.parse(PrimaryEmailAddr)
          if (PrimaryPhone) parsedPrimaryPhone = JSON.parse(PrimaryPhone)
          if (AccountRef) parsedAccountRef = JSON.parse(AccountRef)
          if (EntityRef) parsedEntityRef = JSON.parse(EntityRef)
        } catch (error: any) {
          throw new Error(`Invalid JSON input: ${error.message}`)
        }

        return {
          apiKey,
          realmId,
          ...rest,
          ...(parsedCustomerRef && { CustomerRef: parsedCustomerRef }),
          ...(parsedLine && { Line: parsedLine }),
          ...(parsedBillEmail && { BillEmail: parsedBillEmail }),
          ...(parsedPrimaryEmailAddr && { PrimaryEmailAddr: parsedPrimaryEmailAddr }),
          ...(parsedPrimaryPhone && { PrimaryPhone: parsedPrimaryPhone }),
          ...(parsedAccountRef && { AccountRef: parsedAccountRef }),
          ...(parsedEntityRef && { EntityRef: parsedEntityRef }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'QuickBooks OAuth access token' },
    realmId: { type: 'string', description: 'QuickBooks company ID (realm ID)' },
    // Common inputs
    Id: { type: 'string', description: 'Resource ID' },
    Line: { type: 'json', description: 'Line items array' },
    TxnDate: { type: 'string', description: 'Transaction date (YYYY-MM-DD)' },
    DueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
    DocNumber: { type: 'string', description: 'Document number' },
    // Invoice inputs
    CustomerRef: { type: 'json', description: 'Customer reference object' },
    BillEmail: { type: 'json', description: 'Billing email object' },
    // Customer inputs
    DisplayName: { type: 'string', description: 'Customer display name' },
    CompanyName: { type: 'string', description: 'Company name' },
    GivenName: { type: 'string', description: 'First name' },
    FamilyName: { type: 'string', description: 'Last name' },
    PrimaryEmailAddr: { type: 'json', description: 'Primary email address object' },
    PrimaryPhone: { type: 'json', description: 'Primary phone object' },
    // Expense inputs
    AccountRef: { type: 'json', description: 'Account reference object' },
    PaymentType: { type: 'string', description: 'Payment type (Cash, Check, CreditCard)' },
    EntityRef: { type: 'json', description: 'Entity (vendor/customer) reference object' },
    PrivateNote: { type: 'string', description: 'Private note' },
    // List inputs
    query: { type: 'string', description: 'SQL query string' },
    maxResults: { type: 'number', description: 'Maximum results to return' },
    startPosition: { type: 'number', description: 'Pagination start position' },
  },
  outputs: {
    // Invoice outputs
    invoice: { type: 'json', description: 'Invoice object' },
    invoices: { type: 'json', description: 'Array of invoices' },
    // Customer outputs
    customer: { type: 'json', description: 'Customer object' },
    customers: { type: 'json', description: 'Array of customers' },
    // Expense outputs
    expense: { type: 'json', description: 'Expense object' },
    expenses: { type: 'json', description: 'Array of expenses' },
    // Common outputs
    metadata: { type: 'json', description: 'Operation metadata' },
  },
}
