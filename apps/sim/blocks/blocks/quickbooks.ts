import { QuickBooksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { QuickBooksResponse } from '@/tools/quickbooks/types'

const LIST_OPERATIONS = ['list_vendors', 'list_purchase_orders', 'list_bills']

export const QuickBooksBlock: BlockConfig<QuickBooksResponse> = {
  type: 'quickbooks',
  name: 'QuickBooks',
  description: 'Query vendors, purchase orders, and bills in QuickBooks Online',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate QuickBooks Online into procurement workflows. List vendors, purchase orders, and bills, or run custom QuickBooks Accounting API queries against a company.',
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
        { label: 'List Vendors', id: 'list_vendors' },
        { label: 'List Purchase Orders', id: 'list_purchase_orders' },
        { label: 'List Bills', id: 'list_bills' },
        { label: 'Run Query', id: 'query' },
      ],
      value: () => 'list_vendors',
    },
    {
      id: 'credential',
      title: 'QuickBooks Account',
      type: 'oauth-input',
      serviceId: 'quickbooks',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('quickbooks'),
      placeholder: 'Select QuickBooks account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'QuickBooks Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'realmId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Company ID returned by Intuit as realmId',
      required: true,
    },
    {
      id: 'activeOnly',
      title: 'Active Vendors Only',
      type: 'switch',
      condition: { field: 'operation', value: 'list_vendors' },
    },
    {
      id: 'startPosition',
      title: 'Start Position',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '1000 or less',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'SELECT * FROM Vendor MAXRESULTS 10',
      condition: { field: 'operation', value: 'query' },
      required: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a QuickBooks Online Accounting API SQL-like query. Return ONLY the query text.',
        placeholder: 'Describe what QuickBooks records to query...',
      },
    },
    {
      id: 'minorVersion',
      title: 'Minor Version',
      type: 'short-input',
      placeholder: '75',
      mode: 'advanced',
    },
    {
      id: 'apiEnvironment',
      title: 'Environment',
      type: 'dropdown',
      options: [
        { label: 'Production', id: 'production' },
        { label: 'Sandbox', id: 'sandbox' },
      ],
      value: () => 'production',
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'quickbooks_list_vendors',
      'quickbooks_list_purchase_orders',
      'quickbooks_list_bills',
      'quickbooks_query',
    ],
    config: {
      tool: (params) => `quickbooks_${params.operation}`,
      params: (params) => ({
        credential: params.oauthCredential,
        realmId: params.realmId,
        activeOnly: params.activeOnly,
        startPosition: params.startPosition,
        maxResults: params.maxResults,
        query: params.query,
        apiEnvironment: params.apiEnvironment,
        minorVersion: params.minorVersion,
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'QuickBooks operation to perform' },
    oauthCredential: { type: 'string', description: 'QuickBooks OAuth credential' },
    realmId: {
      type: 'string',
      description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
    },
    activeOnly: { type: 'boolean', description: 'Only return active vendors' },
    startPosition: { type: 'string', description: 'One-based start position for pagination' },
    maxResults: { type: 'string', description: 'Maximum number of records to return, up to 1000' },
    query: { type: 'string', description: 'QuickBooks SQL-like query to execute' },
    apiEnvironment: {
      type: 'string',
      description: 'QuickBooks API environment: production or sandbox',
    },
    minorVersion: { type: 'string', description: 'QuickBooks Accounting API minor version' },
  },
  outputs: {
    items: {
      type: 'json',
      description: 'QuickBooks records returned by the query',
    },
    entity: {
      type: 'string',
      description: 'QuickBooks entity name returned by the query',
    },
    totalCount: {
      type: 'number',
      description: 'Total count returned by QuickBooks for the query',
    },
    startPosition: {
      type: 'number',
      description: 'Start position returned by QuickBooks',
    },
    maxResults: {
      type: 'number',
      description: 'Maximum records returned by QuickBooks',
    },
    query: {
      type: 'string',
      description: 'Query that was executed',
    },
  },
}

export const QuickBooksBlockMeta = {
  tags: ['payments', 'automation'],
  url: 'https://quickbooks.intuit.com',
  templates: [
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks vendor intake',
      prompt:
        'Build a workflow that lists QuickBooks vendors, compares them against submitted procurement requests in a table, and flags requests that reference unknown vendors.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks purchase order monitor',
      prompt:
        'Build a scheduled workflow that lists recent QuickBooks purchase orders, summarizes new commitments by vendor, and posts the digest to a Slack channel.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks bill approval queue',
      prompt:
        'Build a scheduled workflow that lists QuickBooks bills, identifies bills with open balances, and emails finance a queue grouped by due date.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks procurement assistant',
      prompt:
        'Build an agent that answers procurement questions by querying QuickBooks vendors, bills, and purchase orders on demand.',
      modules: ['agent'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks vendor spend report',
      prompt:
        'Build a weekly workflow that queries QuickBooks bills, rolls up total open balance by vendor, stores the result in a table, and emails the report to finance.',
      modules: ['workflows', 'scheduled', 'tables'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks purchase order reconciliation',
      prompt:
        'Build a workflow that lists QuickBooks purchase orders and bills, matches them by vendor and amount, and flags bills without a matching purchase order.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: QuickBooksIcon,
      title: 'QuickBooks aging alert',
      prompt:
        'Build a scheduled workflow that queries QuickBooks bills by due date and sends a Slack alert for any unpaid bills due this week.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'vendor-master-audit',
      description: 'Compare procurement requests against active QuickBooks vendors.',
      content:
        '# Vendor Master Audit\n\nCheck whether procurement requests reference vendors that exist in QuickBooks Online.\n\n## Steps\n1. List vendors from QuickBooks with activeOnly enabled.\n2. Compare the vendor names or IDs in the incoming request table against the returned vendor records.\n3. Flag requests that do not match an active vendor.\n4. Route flagged rows to the procurement owner for review.\n\n## Output\nReturn the matched vendors, unmatched requests, and a short summary of follow-up work.',
    },
    {
      name: 'open-bill-aging-alert',
      description: 'Find open QuickBooks bills that need attention before payment deadlines.',
      content:
        '# Open Bill Aging Alert\n\nMonitor unpaid QuickBooks bills and surface near-term payment risk.\n\n## Steps\n1. Query QuickBooks bills with a MAXRESULTS limit and the needed date filters.\n2. Identify bills with an open Balance and group them by due date or vendor.\n3. Summarize the highest-priority bills for finance.\n4. Send the summary to the preferred notification channel.\n\n## Output\nReturn the overdue or upcoming bills, grouped totals, and the notification text.',
    },
    {
      name: 'purchase-order-monitor',
      description: 'Summarize recent QuickBooks purchase orders for procurement review.',
      content:
        '# Purchase Order Monitor\n\nTrack recent purchase order activity in QuickBooks Online.\n\n## Steps\n1. List or query QuickBooks purchase orders for the review window.\n2. Group purchase orders by vendor and transaction date.\n3. Highlight high-value or unusual purchase orders for manual review.\n4. Save or send the procurement digest.\n\n## Output\nReturn the reviewed purchase orders, vendor totals, and a concise digest.',
    },
    {
      name: 'po-bill-reconciliation',
      description: 'Compare QuickBooks purchase orders and bills to spot mismatches.',
      content:
        '# PO Bill Reconciliation\n\nUse QuickBooks purchase orders and bills to identify possible matching issues.\n\n## Steps\n1. List purchase orders and bills for the same company and time window.\n2. Match records by vendor, date, document number, or amount where available.\n3. Flag bills without a likely purchase order match.\n4. Summarize exceptions for accounting review.\n\n## Output\nReturn matched records, unmatched bills, and the reconciliation summary.',
    },
    {
      name: 'vendor-spend-summary',
      description: 'Roll up QuickBooks bill data into a vendor spend summary.',
      content:
        '# Vendor Spend Summary\n\nCreate a vendor-level spend view from QuickBooks bill records.\n\n## Steps\n1. Query QuickBooks bills with a bounded MAXRESULTS value.\n2. Group bill totals and balances by vendor reference when present.\n3. Rank vendors by total amount or open balance.\n4. Store or send the summarized report.\n\n## Output\nReturn vendor totals, open balances, and a short explanation of the largest spend drivers.',
    },
  ],
} as const satisfies BlockMeta
