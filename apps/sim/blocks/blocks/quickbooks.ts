import { QuickBooksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { QuickBooksResponse } from '@/tools/quickbooks/types'

const LIST_OPERATIONS = [
  'quickbooks_list_vendors',
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
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`)
  }
  if (fieldName === 'startPosition' && parsed < 1) {
    throw new Error('startPosition must be a positive integer')
  }
  if (fieldName === 'maxResults' && (parsed < 1 || parsed > 100)) {
    throw new Error('maxResults must be an integer from 1 through 100')
  }
  return parsed
}

export const QuickBooksBlock: BlockConfig<QuickBooksResponse> = {
  type: 'quickbooks',
  name: 'QuickBooks',
  description: 'Read procurement data from QuickBooks Online',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect one QuickBooks Online company and read its company profile, vendors, purchase orders, and bills. The connected company is selected during OAuth and cannot be overridden by workflow input.',
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
        { label: 'Get Company Info', id: 'quickbooks_get_company_info' },
        { label: 'List Vendors', id: 'quickbooks_list_vendors' },
        { label: 'List Purchase Orders', id: 'quickbooks_list_purchase_orders' },
        { label: 'List Bills', id: 'quickbooks_list_bills' },
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
      id: 'startPosition',
      title: 'Start Position',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      value: () => '1',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      mode: 'advanced',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      value: () => '25',
    },
  ],
  tools: {
    access: [
      'quickbooks_get_company_info',
      'quickbooks_list_bills',
      'quickbooks_list_purchase_orders',
      'quickbooks_list_vendors',
    ],
    config: {
      tool: (params) => {
        const operation = String(params.operation)
        if (
          operation !== 'quickbooks_get_company_info' &&
          operation !== 'quickbooks_list_vendors' &&
          operation !== 'quickbooks_list_purchase_orders' &&
          operation !== 'quickbooks_list_bills'
        ) {
          throw new Error(`Unknown QuickBooks operation: ${operation}`)
        }
        return operation
      },
      params: (params) => {
        const operation = String(params.operation)
        if (!LIST_OPERATIONS.includes(operation as (typeof LIST_OPERATIONS)[number])) {
          return { credential: params.oauthCredential }
        }
        return {
          credential: params.oauthCredential,
          startPosition: parsePaginationInteger(params.startPosition, 'startPosition', 1),
          maxResults: parsePaginationInteger(params.maxResults, 'maxResults', 25),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'QuickBooks read operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'OAuth credential bound to one QuickBooks company',
    },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first list item to request',
    },
    maxResults: {
      type: 'number',
      description: 'Number of list items to request, from 1 through 100',
    },
  },
  outputs: {
    company: {
      type: 'json',
      description:
        'CompanyInfo with Id, CompanyName, LegalName, addresses, contact details, company settings, and MetaData',
      condition: { field: 'operation', value: 'quickbooks_get_company_info' },
    },
    items: {
      type: 'array',
      description:
        'Vendor, PurchaseOrder, or Bill objects with their native QuickBooks fields, references, lines, balances, and MetaData when populated',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first returned list item',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    maxResults: {
      type: 'number',
      description: 'Actual number of items reported for the list response',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    nextStartPosition: {
      type: 'number',
      description: 'Position to pass into an explicit next-page request',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    hasMore: {
      type: 'boolean',
      description: 'Conservative indication that another list page may exist',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
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
      title: 'QuickBooks vendor directory audit',
      prompt:
        'Build a scheduled workflow that lists every QuickBooks vendor page, identifies incomplete or inactive vendor records, and writes a read-only audit report to a Sim table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'audit', 'procurement'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks duplicate vendor review',
      prompt:
        'Create a workflow that lists QuickBooks vendors page by page, detects likely duplicates using names and contact details, and produces a review queue without changing vendor records.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'data-quality', 'procurement'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks purchase order digest',
      prompt:
        'Create a scheduled workflow that lists recent QuickBooks purchase orders, summarizes vendors, dates, lines, and totals, and posts a procurement digest to Slack.',
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
      title: 'QuickBooks unpaid bill report',
      prompt:
        'Build a scheduled workflow that lists QuickBooks bills, filters records with a remaining balance, groups them by vendor and due date, and writes an unpaid-payables report.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'payables'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks overdue payable alert',
      prompt:
        'Create a daily workflow that lists QuickBooks bills, identifies unpaid balances past their due date, summarizes the urgent items, and posts a read-only alert to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'alerts', 'payables'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks vendor spend summary',
      prompt:
        'Create a monthly workflow that lists QuickBooks bills, aggregates bill totals by vendor and currency, compares the current period with prior table snapshots, and produces a vendor-spend summary.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analytics', 'procurement'],
    },
  ],
  skills: [
    {
      name: 'audit-vendor-directory',
      description:
        'List QuickBooks vendors and report incomplete, inactive, or inconsistent directory records.',
      content:
        '# Audit a QuickBooks Vendor Directory\n\nReview vendor records without modifying them.\n\n## Steps\n1. Use List Vendors with the default page size.\n2. Continue with `nextStartPosition` while `hasMore` is true.\n3. Check populated vendor identity, contact, address, active-status, currency, and metadata fields.\n4. Report incomplete or inconsistent records for human review.\n\n## Output\nReturn a vendor-audit table with the vendor ID, display name, issue, and supporting field values. Do not claim to merge or update vendors.',
    },
    {
      name: 'review-duplicate-vendors',
      description: 'Find likely duplicate QuickBooks vendors using the read-only vendor directory.',
      content:
        '# Review Possible Duplicate QuickBooks Vendors\n\nIdentify likely duplicates for human review.\n\n## Steps\n1. List all Vendor pages using `nextStartPosition`.\n2. Compare normalized display names, company names, emails, phones, and addresses.\n3. Rank possible matches by evidence and retain both vendor IDs.\n\n## Output\nReturn duplicate candidates with match evidence and confidence. Do not merge or edit vendor records.',
    },
    {
      name: 'summarize-purchase-orders',
      description: 'Build a digest from QuickBooks purchase order pages.',
      content:
        '# Summarize QuickBooks Purchase Orders\n\nCreate a read-only procurement digest.\n\n## Steps\n1. Use List Purchase Orders for the requested page.\n2. Continue only when the workflow explicitly needs more pages.\n3. Summarize document number, date, vendor reference, lines, currency, and total where populated.\n\n## Output\nReturn a concise purchase-order digest and include source purchase-order IDs.',
    },
    {
      name: 'reconcile-pos-to-bills',
      description:
        'Compare QuickBooks purchase orders and bills and flag likely reconciliation exceptions.',
      content:
        '# Reconcile QuickBooks Purchase Orders to Bills\n\nCompare read-only procurement records.\n\n## Steps\n1. List Purchase Orders and Bills for the target period or explicit pages.\n2. Match records using vendor references, document numbers, dates, line descriptions, and amounts.\n3. Flag missing matches, amount differences, currency differences, and duplicate candidates.\n\n## Output\nReturn a reconciliation report with QuickBooks IDs and supporting values. Do not modify bills or close purchase orders.',
    },
    {
      name: 'report-unpaid-bills',
      description: 'Report QuickBooks bills that retain an unpaid balance.',
      content:
        '# Report Unpaid QuickBooks Bills\n\nCreate a read-only accounts-payable report.\n\n## Steps\n1. List Bills page by page as needed.\n2. Keep bills whose populated `Balance` is greater than zero.\n3. Group by vendor, currency, and due date while retaining bill IDs.\n\n## Output\nReturn unpaid bill details and subtotals. Do not mark bills paid or change due dates.',
    },
    {
      name: 'alert-overdue-payables',
      description: 'Identify overdue QuickBooks bill balances for an alert.',
      content:
        '# Alert on Overdue QuickBooks Payables\n\nFind overdue items without changing accounting data.\n\n## Steps\n1. List Bills and retain records with a positive balance and a due date before today.\n2. Sort the result by days overdue and balance.\n3. Include vendor reference, document number, due date, currency, balance, and bill ID where populated.\n\n## Output\nReturn an urgency-ranked alert ready for delivery. Do not modify or pay bills.',
    },
    {
      name: 'summarize-vendor-spend',
      description: 'Aggregate QuickBooks bill totals into a vendor-spend summary.',
      content:
        '# Summarize QuickBooks Vendor Spend\n\nAnalyze bill totals from read-only data.\n\n## Steps\n1. List the required Bill pages.\n2. Group populated totals by vendor reference and currency.\n3. Keep bill IDs so every aggregate can be traced to source records.\n4. State any limitations caused by missing fields or partial pagination.\n\n## Output\nReturn vendor totals, bill counts, currencies, and source coverage. Do not present the result as a general-ledger or payment report.',
    },
  ],
} as const satisfies BlockMeta
