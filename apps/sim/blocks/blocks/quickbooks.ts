import { QuickBooksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { QuickBooksResponse } from '@/tools/quickbooks/types'
import { parseQuickBooksAddress } from '@/tools/quickbooks/utils'

const MASTER_DATA_OPERATION = 'quickbooks_read_master_data'
const CUSTOMER_OPERATIONS = ['quickbooks_create_customer', 'quickbooks_update_customer'] as const
const VENDOR_OPERATIONS = ['quickbooks_create_vendor', 'quickbooks_update_vendor'] as const
const ITEM_OPERATIONS = ['quickbooks_create_item', 'quickbooks_update_item'] as const
const UPDATE_OPERATIONS = [
  'quickbooks_update_customer',
  'quickbooks_update_item',
  'quickbooks_update_vendor',
] as const
const MUTATION_OPERATIONS = [
  ...CUSTOMER_OPERATIONS,
  ...ITEM_OPERATIONS,
  ...VENDOR_OPERATIONS,
] as const
const PAGINATED_OPERATIONS = [
  MASTER_DATA_OPERATION,
  'quickbooks_list_purchase_orders',
  'quickbooks_list_bills',
] as const
const TRANSACTION_LIST_OPERATIONS = [
  'quickbooks_list_purchase_orders',
  'quickbooks_list_bills',
] as const
const QUICKBOOKS_OPERATIONS = [
  'quickbooks_get_company_info',
  MASTER_DATA_OPERATION,
  ...MUTATION_OPERATIONS,
  'quickbooks_list_purchase_orders',
  'quickbooks_list_bills',
] as const

function parsePaginationInteger(
  value: unknown,
  fieldName: 'startPosition' | 'maxResults',
  fallback: number
): number {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${fieldName} must be an integer`)
  if (fieldName === 'startPosition' && parsed < 1) {
    throw new Error('startPosition must be a positive integer')
  }
  if (fieldName === 'maxResults' && (parsed < 1 || parsed > 100)) {
    throw new Error('maxResults must be an integer from 1 through 100')
  }
  return parsed
}

function parseOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} must be a finite number`)
  return parsed
}

function parseTriStateBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value == null || value === '' || value === 'not_specified') return undefined
  if (value === true || value === 'yes') return true
  if (value === false || value === 'no') return false
  throw new Error(`${fieldName} must be not specified, yes, or no`)
}

function optionalValue(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

function paginationCondition(values?: Record<string, unknown>) {
  if (values?.operation === MASTER_DATA_OPERATION) {
    return { field: 'readMode', value: 'list' }
  }
  return { field: 'operation', value: [...TRANSACTION_LIST_OPERATIONS] }
}

export const QuickBooksBlock: BlockConfig<QuickBooksResponse> = {
  type: 'quickbooks',
  name: 'QuickBooks',
  description: 'Read and manage QuickBooks Online company and master data',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect one QuickBooks Online company to read company, master-data, purchase-order, and bill records and to create or update customers, vendors, and basic products or services.',
  docsLink: 'https://docs.sim.ai/integrations/quickbooks',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#2CA01C',
  icon: QuickBooksIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Company: Get Info', id: 'quickbooks_get_company_info' },
        { label: 'Master Data: Read', id: 'quickbooks_read_master_data' },
        { label: 'Customers: Create', id: 'quickbooks_create_customer' },
        { label: 'Customers: Update', id: 'quickbooks_update_customer' },
        { label: 'Vendors: Create', id: 'quickbooks_create_vendor' },
        { label: 'Vendors: Update', id: 'quickbooks_update_vendor' },
        { label: 'Items: Create', id: 'quickbooks_create_item' },
        { label: 'Items: Update', id: 'quickbooks_update_item' },
        { label: 'Purchasing: List Purchase Orders', id: 'quickbooks_list_purchase_orders' },
        { label: 'Payables: List Bills', id: 'quickbooks_list_bills' },
      ],
      value: () => 'quickbooks_get_company_info',
    },
    {
      id: 'credential',
      title: 'QuickBooks Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'quickbooks',
      requiredScopes: getScopesForService('quickbooks'),
      placeholder: 'Select QuickBooks company',
      required: true,
    },
    {
      id: 'recordType',
      title: 'Record Type',
      type: 'dropdown',
      options: [
        { label: 'Account', id: 'account' },
        { label: 'Customer', id: 'customer' },
        { label: 'Vendor', id: 'vendor' },
        { label: 'Item', id: 'item' },
        { label: 'Employee', id: 'employee' },
      ],
      condition: { field: 'operation', value: MASTER_DATA_OPERATION },
      required: { field: 'operation', value: MASTER_DATA_OPERATION },
      value: () => 'account',
    },
    {
      id: 'readMode',
      title: 'Read Mode',
      type: 'dropdown',
      options: [
        { label: 'List', id: 'list' },
        { label: 'By ID', id: 'by_id' },
      ],
      condition: { field: 'operation', value: MASTER_DATA_OPERATION },
      required: { field: 'operation', value: MASTER_DATA_OPERATION },
      value: () => 'list',
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'QuickBooks record ID',
      condition: {
        field: 'operation',
        value: MASTER_DATA_OPERATION,
        and: { field: 'readMode', value: 'by_id' },
      },
      required: {
        field: 'operation',
        value: MASTER_DATA_OPERATION,
        and: { field: 'readMode', value: 'by_id' },
      },
    },
    {
      id: 'startPosition',
      title: 'Start Position',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: paginationCondition,
      value: () => '1',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      mode: 'advanced',
      condition: paginationCondition,
      value: () => '25',
    },
    {
      id: 'customerId',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'QuickBooks customer ID',
      condition: { field: 'operation', value: 'quickbooks_update_customer' },
      required: { field: 'operation', value: 'quickbooks_update_customer' },
    },
    {
      id: 'vendorId',
      title: 'Vendor ID',
      type: 'short-input',
      placeholder: 'QuickBooks vendor ID',
      condition: { field: 'operation', value: 'quickbooks_update_vendor' },
      required: { field: 'operation', value: 'quickbooks_update_vendor' },
    },
    {
      id: 'itemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'QuickBooks item ID',
      condition: { field: 'operation', value: 'quickbooks_update_item' },
      required: { field: 'operation', value: 'quickbooks_update_item' },
    },
    {
      id: 'syncToken',
      title: 'Sync Token',
      type: 'short-input',
      placeholder: 'Current QuickBooks sync token',
      condition: { field: 'operation', value: [...UPDATE_OPERATIONS] },
      required: { field: 'operation', value: [...UPDATE_OPERATIONS] },
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Unique display name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
      required: {
        field: 'operation',
        value: ['quickbooks_create_customer', 'quickbooks_create_vendor'],
      },
    },
    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Company name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'givenName',
      title: 'Given Name',
      type: 'short-input',
      placeholder: 'Given name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'familyName',
      title: 'Family Name',
      type: 'short-input',
      placeholder: 'Family name',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'primaryEmail',
      title: 'Primary Email',
      type: 'short-input',
      placeholder: 'name@example.com',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'primaryPhone',
      title: 'Primary Phone',
      type: 'short-input',
      placeholder: 'Phone number',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
    },
    {
      id: 'billingAddress',
      title: 'Billing Address (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{"line1":"123 Main St","city":"San Francisco","countrySubDivisionCode":"CA","postalCode":"94105"}',
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...VENDOR_OPERATIONS],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks address JSON object using only line1, line2, city, countrySubDivisionCode, postalCode, and country. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'shippingAddress',
      title: 'Shipping Address (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{"line1":"123 Main St","city":"San Francisco","countrySubDivisionCode":"CA","postalCode":"94105"}',
      condition: { field: 'operation', value: [...CUSTOMER_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks address JSON object using only line1, line2, city, countrySubDivisionCode, postalCode, and country. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'printOnCheckName',
      title: 'Print on Check Name',
      type: 'short-input',
      placeholder: 'Name printed on checks',
      condition: { field: 'operation', value: [...VENDOR_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'accountNumber',
      title: 'Vendor Account Number',
      type: 'short-input',
      placeholder: 'Account number',
      condition: { field: 'operation', value: [...VENDOR_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'vendor1099',
      title: '1099 Vendor',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: 'not_specified' },
        { label: 'Yes', id: 'yes' },
        { label: 'No', id: 'no' },
      ],
      condition: { field: 'operation', value: [...VENDOR_OPERATIONS] },
      mode: 'advanced',
      value: () => 'not_specified',
    },
    {
      id: 'name',
      title: 'Item Name',
      type: 'short-input',
      placeholder: 'Unique item name',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      required: { field: 'operation', value: 'quickbooks_create_item' },
    },
    {
      id: 'itemType',
      title: 'Item Type',
      type: 'dropdown',
      options: [
        { label: 'Service', id: 'service' },
        { label: 'Non-inventory', id: 'non_inventory' },
      ],
      condition: { field: 'operation', value: 'quickbooks_create_item' },
      required: { field: 'operation', value: 'quickbooks_create_item' },
      value: () => 'service',
    },
    {
      id: 'incomeAccountId',
      title: 'Income Account ID',
      type: 'short-input',
      placeholder: 'QuickBooks income account ID',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      required: { field: 'operation', value: 'quickbooks_create_item' },
    },
    {
      id: 'description',
      title: 'Sales Description',
      type: 'long-input',
      placeholder: 'Item sales description',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
    },
    {
      id: 'unitPrice',
      title: 'Unit Price',
      type: 'short-input',
      placeholder: '0.00',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
    },
    {
      id: 'purchaseDescription',
      title: 'Purchase Description',
      type: 'long-input',
      placeholder: 'Item purchase description',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'purchaseCost',
      title: 'Purchase Cost',
      type: 'short-input',
      placeholder: '0.00',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'expenseAccountId',
      title: 'Expense Account ID',
      type: 'short-input',
      placeholder: 'QuickBooks expense account ID',
      condition: { field: 'operation', value: [...ITEM_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'taxable',
      title: 'Taxable',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: 'not_specified' },
        { label: 'Yes', id: 'yes' },
        { label: 'No', id: 'no' },
      ],
      condition: {
        field: 'operation',
        value: [...CUSTOMER_OPERATIONS, ...ITEM_OPERATIONS],
      },
      mode: 'advanced',
      value: () => 'not_specified',
    },
    {
      id: 'activeStatus',
      title: 'Active Status',
      type: 'dropdown',
      options: [
        { label: 'Unchanged', id: 'unchanged' },
        { label: 'Active', id: 'active' },
        { label: 'Inactive', id: 'inactive' },
      ],
      condition: { field: 'operation', value: [...UPDATE_OPERATIONS] },
      value: () => 'unchanged',
    },
  ],
  tools: {
    access: [
      'quickbooks_get_company_info',
      'quickbooks_read_master_data',
      'quickbooks_create_customer',
      'quickbooks_update_customer',
      'quickbooks_create_vendor',
      'quickbooks_update_vendor',
      'quickbooks_create_item',
      'quickbooks_update_item',
      'quickbooks_list_purchase_orders',
      'quickbooks_list_bills',
    ],
    config: {
      tool: (params) => {
        const operation = String(params.operation)
        if (!QUICKBOOKS_OPERATIONS.includes(operation as (typeof QUICKBOOKS_OPERATIONS)[number])) {
          throw new Error(`Unknown QuickBooks operation: ${operation}`)
        }
        return operation
      },
      params: (params) => {
        const operation = String(params.operation)
        const oauthCredentialValue = params.oauthCredential

        if (operation === MASTER_DATA_OPERATION) {
          if (params.readMode === 'by_id') {
            return {
              credential: oauthCredentialValue,
              recordType: params.recordType,
              readMode: params.readMode,
              recordId: optionalValue(params.recordId),
            }
          }
          return {
            credential: oauthCredentialValue,
            recordType: params.recordType,
            readMode: params.readMode,
            startPosition: parsePaginationInteger(params.startPosition, 'startPosition', 1),
            maxResults: parsePaginationInteger(params.maxResults, 'maxResults', 25),
          }
        }
        if (
          operation === 'quickbooks_list_purchase_orders' ||
          operation === 'quickbooks_list_bills'
        ) {
          return {
            credential: oauthCredentialValue,
            startPosition: parsePaginationInteger(params.startPosition, 'startPosition', 1),
            maxResults: parsePaginationInteger(params.maxResults, 'maxResults', 25),
          }
        }
        if (
          operation === 'quickbooks_create_customer' ||
          operation === 'quickbooks_update_customer'
        ) {
          return {
            credential: oauthCredentialValue,
            customerId: optionalValue(params.customerId),
            syncToken: optionalValue(params.syncToken),
            displayName: optionalValue(params.displayName),
            companyName: optionalValue(params.companyName),
            givenName: optionalValue(params.givenName),
            familyName: optionalValue(params.familyName),
            primaryEmail: optionalValue(params.primaryEmail),
            primaryPhone: optionalValue(params.primaryPhone),
            billingAddress: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
            shippingAddress: parseQuickBooksAddress(params.shippingAddress, 'shippingAddress'),
            taxable: parseTriStateBoolean(params.taxable, 'taxable'),
            activeStatus: params.activeStatus ?? 'unchanged',
          }
        }
        if (operation === 'quickbooks_create_vendor' || operation === 'quickbooks_update_vendor') {
          return {
            credential: oauthCredentialValue,
            vendorId: optionalValue(params.vendorId),
            syncToken: optionalValue(params.syncToken),
            displayName: optionalValue(params.displayName),
            companyName: optionalValue(params.companyName),
            givenName: optionalValue(params.givenName),
            familyName: optionalValue(params.familyName),
            primaryEmail: optionalValue(params.primaryEmail),
            primaryPhone: optionalValue(params.primaryPhone),
            billingAddress: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
            printOnCheckName: optionalValue(params.printOnCheckName),
            accountNumber: optionalValue(params.accountNumber),
            vendor1099: parseTriStateBoolean(params.vendor1099, 'vendor1099'),
            activeStatus: params.activeStatus ?? 'unchanged',
          }
        }
        if (operation === 'quickbooks_create_item' || operation === 'quickbooks_update_item') {
          return {
            credential: oauthCredentialValue,
            itemId: optionalValue(params.itemId),
            syncToken: optionalValue(params.syncToken),
            name: optionalValue(params.name),
            itemType: optionalValue(params.itemType),
            incomeAccountId: optionalValue(params.incomeAccountId),
            description: optionalValue(params.description),
            unitPrice: parseOptionalNumber(params.unitPrice, 'unitPrice'),
            purchaseDescription: optionalValue(params.purchaseDescription),
            purchaseCost: parseOptionalNumber(params.purchaseCost, 'purchaseCost'),
            expenseAccountId: optionalValue(params.expenseAccountId),
            taxable: parseTriStateBoolean(params.taxable, 'taxable'),
            activeStatus: params.activeStatus ?? 'unchanged',
          }
        }
        return { credential: oauthCredentialValue }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'QuickBooks operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'OAuth credential bound to one QuickBooks company',
    },
    recordType: { type: 'string', description: 'Master-data entity type' },
    readMode: { type: 'string', description: 'List or by-ID read mode' },
    recordId: { type: 'string', description: 'Master-data record ID' },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first list item to request',
    },
    maxResults: {
      type: 'number',
      description: 'Number of list items to request, from 1 through 100',
    },
    customerId: { type: 'string', description: 'Customer ID for an update' },
    vendorId: { type: 'string', description: 'Vendor ID for an update' },
    itemId: { type: 'string', description: 'Item ID for an update' },
    syncToken: { type: 'string', description: 'Current entity sync token' },
    displayName: { type: 'string', description: 'Customer or vendor display name' },
    companyName: { type: 'string', description: 'Customer or vendor company name' },
    givenName: { type: 'string', description: 'Customer or vendor given name' },
    familyName: { type: 'string', description: 'Customer or vendor family name' },
    primaryEmail: { type: 'string', description: 'Primary email address' },
    primaryPhone: { type: 'string', description: 'Primary phone number' },
    billingAddress: { type: 'json', description: 'Allowlisted billing address object' },
    shippingAddress: { type: 'json', description: 'Allowlisted shipping address object' },
    taxable: { type: 'boolean', description: 'Optional taxable value' },
    printOnCheckName: { type: 'string', description: 'Vendor name printed on checks' },
    accountNumber: { type: 'string', description: 'Vendor account number' },
    vendor1099: { type: 'boolean', description: 'Optional vendor 1099 value' },
    name: { type: 'string', description: 'Item name' },
    itemType: { type: 'string', description: 'Service or Non-inventory item type' },
    incomeAccountId: { type: 'string', description: 'Item income account ID' },
    description: { type: 'string', description: 'Item sales description' },
    unitPrice: { type: 'number', description: 'Item sales price' },
    purchaseDescription: { type: 'string', description: 'Item purchase description' },
    purchaseCost: { type: 'number', description: 'Item purchase cost' },
    expenseAccountId: { type: 'string', description: 'Item expense account ID' },
    activeStatus: { type: 'string', description: 'Entity active-status change' },
  },
  outputs: {
    company: {
      type: 'json',
      description:
        'CompanyInfo with Id, CompanyName, LegalName, addresses, contact details, company settings, and MetaData',
      condition: { field: 'operation', value: 'quickbooks_get_company_info' },
    },
    recordType: {
      type: 'string',
      description: 'Master-data record type returned by the read',
      condition: { field: 'operation', value: MASTER_DATA_OPERATION },
    },
    item: {
      type: 'json',
      description:
        'Single Account, Customer, Vendor, Item, or Employee with native QuickBooks fields',
      condition: {
        field: 'operation',
        value: MASTER_DATA_OPERATION,
        and: { field: 'readMode', value: 'by_id' },
      },
    },
    items: {
      type: 'array',
      description:
        'Account, Customer, Vendor, Item, Employee, PurchaseOrder, or Bill objects with native QuickBooks fields',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first returned list item',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
    maxResults: {
      type: 'number',
      description: 'Actual number of items reported for the list response',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
    nextStartPosition: {
      type: 'number',
      description: 'Position to pass into an explicit next-page request',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
    hasMore: {
      type: 'boolean',
      description: 'Conservative indication that another list page may exist',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
    record: {
      type: 'json',
      description: 'Created or updated Customer, Vendor, or Item with native QuickBooks fields',
      condition: { field: 'operation', value: [...MUTATION_OPERATIONS] },
    },
    recordId: {
      type: 'string',
      description: 'ID of the created or updated QuickBooks record',
      condition: { field: 'operation', value: [...MUTATION_OPERATIONS] },
    },
    syncToken: {
      type: 'string',
      description: 'Latest QuickBooks sync token for a subsequent update',
      condition: { field: 'operation', value: [...MUTATION_OPERATIONS] },
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
    },
  },
}

export const QuickBooksBlockMeta = {
  tags: ['payments', 'automation', 'data-analytics'],
  url: 'https://quickbooks.intuit.com',
  templates: [
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks customer onboarding',
      prompt:
        'Build a workflow that receives an approved customer profile, creates the QuickBooks customer, and stores its ID and sync token in a Sim table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'customers', 'onboarding'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks vendor onboarding',
      prompt:
        'Create a workflow that receives approved vendor identity, contact, address, and 1099 details, creates the QuickBooks vendor, and stores the returned ID and sync token.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'vendors', 'procurement'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks catalogue maintenance',
      prompt:
        'Build a workflow that reads QuickBooks accounts, then creates or updates approved Service and Non-inventory items with the correct income and expense account references.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'catalogue', 'operations'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks master-data audit',
      prompt:
        'Build a scheduled workflow that lists QuickBooks accounts, customers, vendors, items, and employees page by page and writes data-quality findings to a Sim table without changing records.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'audit', 'data-quality'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks purchase order digest',
      prompt:
        'Create a scheduled workflow that lists QuickBooks purchase orders, summarizes vendors, dates, lines, and totals, and posts a procurement digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'procurement'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks PO-to-bill reconciliation',
      prompt:
        'Build a workflow that lists QuickBooks purchase orders and bills, compares vendor references, dates, line details, and totals, and writes suspected mismatches to a review table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reconciliation', 'procurement'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks overdue payable alert',
      prompt:
        'Create a daily workflow that lists QuickBooks bills, identifies unpaid balances past their due date, summarizes urgent items, and posts a read-only alert to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'alerts', 'payables'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'onboard-quickbooks-customers',
      description: 'Create approved QuickBooks customers and retain their IDs and sync tokens.',
      content:
        '# Onboard QuickBooks Customers\n\n## Steps\n1. Validate the approved customer identity and contact details.\n2. Use Customers: Create with a unique display name.\n3. Store the returned `recordId` and `syncToken` for later updates.\n\n## Output\nReturn the created customer, ID, and sync token. Report duplicate-name faults for human review.',
    },
    {
      name: 'onboard-quickbooks-vendors',
      description: 'Create approved QuickBooks vendors with bounded contact and 1099 fields.',
      content:
        '# Onboard QuickBooks Vendors\n\n## Steps\n1. Validate the approved vendor identity, contact, address, and optional 1099 status.\n2. Use Vendors: Create.\n3. Store the returned `recordId` and `syncToken`.\n\n## Output\nReturn the created vendor and identifiers. Do not claim to merge vendors or administer tax identifiers.',
    },
    {
      name: 'maintain-products-and-services',
      description: 'Create or update supported Service and Non-inventory QuickBooks items.',
      content:
        '# Maintain QuickBooks Products and Services\n\n## Steps\n1. Read Account master data to obtain approved account IDs.\n2. Create or update a Service or Non-inventory Item.\n3. Store the latest item ID and sync token.\n\n## Output\nReturn the native Item record. Do not claim to manage Inventory, Category, or Group items.',
    },
    {
      name: 'audit-quickbooks-master-data',
      description: 'Review QuickBooks master-data pages for incomplete or inconsistent records.',
      content:
        '# Audit QuickBooks Master Data\n\n## Steps\n1. Use Master Data: Read in List mode for the required record types.\n2. Continue only with explicit `nextStartPosition` values while `hasMore` is true.\n3. Report incomplete or inconsistent records with their QuickBooks IDs.\n\n## Output\nReturn a read-only audit with source IDs and supporting values.',
    },
    {
      name: 'reconcile-pos-to-bills',
      description:
        'Compare QuickBooks purchase orders and bills and flag likely reconciliation exceptions.',
      content:
        '# Reconcile QuickBooks Purchase Orders to Bills\n\n## Steps\n1. List Purchase Orders and Bills for the required explicit pages.\n2. Match records using vendor references, document numbers, dates, lines, and amounts.\n3. Flag missing matches, amount differences, and duplicate candidates.\n\n## Output\nReturn a reconciliation report with QuickBooks IDs. Do not modify bills or close purchase orders.',
    },
    {
      name: 'report-unpaid-bills',
      description: 'Report QuickBooks bills that retain an unpaid balance.',
      content:
        '# Report Unpaid QuickBooks Bills\n\n## Steps\n1. List Bills page by page as needed.\n2. Keep bills whose populated `Balance` is greater than zero.\n3. Group by vendor, currency, and due date while retaining bill IDs.\n\n## Output\nReturn unpaid bill details and subtotals. Do not mark bills paid or change due dates.',
    },
    {
      name: 'reactivate-master-data-records',
      description:
        'Reactivate a known customer, vendor, or supported item using its current token.',
      content:
        '# Reactivate QuickBooks Master Data\n\n## Steps\n1. Read the inactive record by ID to obtain its current `SyncToken`.\n2. Use the matching Update operation with Active Status set to Active.\n3. Retain the returned latest sync token.\n\n## Output\nReturn the reactivated record and identifiers. Account and employee administration is unsupported.',
    },
  ],
} as const satisfies BlockMeta
