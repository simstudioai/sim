import { RampIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { RampResponse } from '@/tools/ramp/types'

const RAMP_OPERATIONS = [
  'ramp_list_transactions',
  'ramp_get_transaction',
  'ramp_list_users',
  'ramp_get_user',
  'ramp_list_cards',
  'ramp_get_card',
  'ramp_list_limits',
  'ramp_get_limit',
  'ramp_list_reimbursements',
  'ramp_get_reimbursement',
  'ramp_list_bills',
  'ramp_get_bill',
  'ramp_list_departments',
  'ramp_get_department',
  'ramp_create_department',
  'ramp_list_vendors',
  'ramp_get_vendor',
  'ramp_list_entities',
  'ramp_list_spend_programs',
  'ramp_get_spend_program',
  'ramp_get_business',
  'ramp_get_business_balance',
  'ramp_list_receipts',
  'ramp_get_receipt',
  'ramp_upload_receipt',
] as const

const RAMP_LIST_OPERATIONS = [
  'ramp_list_transactions',
  'ramp_list_users',
  'ramp_list_cards',
  'ramp_list_limits',
  'ramp_list_reimbursements',
  'ramp_list_bills',
  'ramp_list_departments',
  'ramp_list_vendors',
  'ramp_list_entities',
  'ramp_list_spend_programs',
  'ramp_list_receipts',
]

export const RampBlock: BlockConfig<RampResponse> = {
  type: 'ramp',
  name: 'Ramp',
  description: 'Manage spend, transactions, reimbursements, bills, and receipts in Ramp',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Ramp into your workflow to automate corporate spend operations. List and inspect card transactions, users, cards, spend limits, reimbursements, bills, departments, and vendors, and upload receipts directly to transactions.',
  docsLink: 'https://docs.sim.ai/integrations/ramp',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  icon: RampIcon,
  bgColor: '#E4F222',
  iconColor: '#E4F222',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Transactions', id: 'ramp_list_transactions' },
        { label: 'Get Transaction', id: 'ramp_get_transaction' },
        { label: 'List Users', id: 'ramp_list_users' },
        { label: 'Get User', id: 'ramp_get_user' },
        { label: 'List Cards', id: 'ramp_list_cards' },
        { label: 'Get Card', id: 'ramp_get_card' },
        { label: 'List Limits', id: 'ramp_list_limits' },
        { label: 'Get Limit', id: 'ramp_get_limit' },
        { label: 'List Reimbursements', id: 'ramp_list_reimbursements' },
        { label: 'Get Reimbursement', id: 'ramp_get_reimbursement' },
        { label: 'List Bills', id: 'ramp_list_bills' },
        { label: 'Get Bill', id: 'ramp_get_bill' },
        { label: 'List Departments', id: 'ramp_list_departments' },
        { label: 'Get Department', id: 'ramp_get_department' },
        { label: 'Create Department', id: 'ramp_create_department' },
        { label: 'List Vendors', id: 'ramp_list_vendors' },
        { label: 'Get Vendor', id: 'ramp_get_vendor' },
        { label: 'List Entities', id: 'ramp_list_entities' },
        { label: 'List Spend Programs', id: 'ramp_list_spend_programs' },
        { label: 'Get Spend Program', id: 'ramp_get_spend_program' },
        { label: 'Get Business', id: 'ramp_get_business' },
        { label: 'Get Business Balance', id: 'ramp_get_business_balance' },
        { label: 'List Receipts', id: 'ramp_list_receipts' },
        { label: 'Get Receipt', id: 'ramp_get_receipt' },
        { label: 'Upload Receipt', id: 'ramp_upload_receipt' },
      ],
      value: () => 'ramp_list_transactions',
    },
    {
      id: 'credential',
      title: 'Ramp Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'ramp',
      requiredScopes: getScopesForService('ramp'),
      placeholder: 'Select Ramp account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Ramp Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    // Resource IDs
    {
      id: 'transactionId',
      title: 'Transaction ID',
      type: 'short-input',
      placeholder: 'Enter transaction ID',
      condition: {
        field: 'operation',
        value: ['ramp_get_transaction', 'ramp_list_receipts', 'ramp_upload_receipt'],
      },
      required: { field: 'operation', value: ['ramp_get_transaction'] },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      condition: {
        field: 'operation',
        value: [
          'ramp_list_transactions',
          'ramp_get_user',
          'ramp_list_cards',
          'ramp_list_limits',
          'ramp_list_reimbursements',
          'ramp_upload_receipt',
        ],
      },
      required: { field: 'operation', value: ['ramp_get_user', 'ramp_upload_receipt'] },
    },
    {
      id: 'cardId',
      title: 'Card ID',
      type: 'short-input',
      placeholder: 'Enter card ID',
      condition: {
        field: 'operation',
        value: ['ramp_list_transactions', 'ramp_get_card', 'ramp_list_limits'],
      },
      required: { field: 'operation', value: ['ramp_get_card'] },
    },
    {
      id: 'limitId',
      title: 'Limit ID',
      type: 'short-input',
      placeholder: 'Enter spend limit ID',
      condition: { field: 'operation', value: 'ramp_get_limit' },
      required: true,
    },
    {
      id: 'reimbursementId',
      title: 'Reimbursement ID',
      type: 'short-input',
      placeholder: 'Enter reimbursement ID',
      condition: { field: 'operation', value: 'ramp_get_reimbursement' },
      required: true,
    },
    {
      id: 'spendProgramId',
      title: 'Spend Program ID',
      type: 'short-input',
      placeholder: 'Enter spend program ID',
      condition: { field: 'operation', value: 'ramp_get_spend_program' },
      required: true,
    },
    {
      id: 'departmentName',
      title: 'Department Name',
      type: 'short-input',
      placeholder: 'Enter department name',
      condition: { field: 'operation', value: 'ramp_create_department' },
      required: true,
    },
    {
      id: 'billId',
      title: 'Bill ID',
      type: 'short-input',
      placeholder: 'Enter bill ID',
      condition: { field: 'operation', value: 'ramp_get_bill' },
      required: true,
    },
    {
      id: 'receiptId',
      title: 'Receipt ID',
      type: 'short-input',
      placeholder: 'Enter receipt ID',
      condition: { field: 'operation', value: 'ramp_get_receipt' },
      required: true,
    },
    // Receipt upload
    {
      id: 'uploadReceiptFile',
      title: 'Receipt File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload receipt image or PDF',
      mode: 'basic',
      multiple: false,
      acceptedTypes: 'image/*,application/pdf',
      required: true,
      condition: { field: 'operation', value: 'ramp_upload_receipt' },
    },
    {
      id: 'receiptFileRef',
      title: 'Receipt File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous blocks',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'ramp_upload_receipt' },
    },
    // Filters
    {
      id: 'departmentId',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'Enter department ID',
      condition: {
        field: 'operation',
        value: ['ramp_list_transactions', 'ramp_list_users', 'ramp_get_department'],
      },
      required: { field: 'operation', value: ['ramp_get_department'] },
    },
    {
      id: 'state',
      title: 'Transaction State',
      type: 'dropdown',
      options: [
        { label: 'All (including declined)', id: 'ALL' },
        { label: 'Cleared', id: 'CLEARED' },
        { label: 'Completion', id: 'COMPLETION' },
        { label: 'Declined', id: 'DECLINED' },
        { label: 'Error', id: 'ERROR' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Pending initiation', id: 'PENDING_INITIATION' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'ramp_list_transactions' },
    },
    {
      id: 'merchantId',
      title: 'Merchant ID',
      type: 'short-input',
      placeholder: 'Filter by merchant ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'ramp_list_transactions' },
    },
    {
      id: 'minAmount',
      title: 'Minimum Amount (USD)',
      type: 'short-input',
      placeholder: '100',
      mode: 'advanced',
      condition: { field: 'operation', value: 'ramp_list_transactions' },
    },
    {
      id: 'maxAmount',
      title: 'Maximum Amount (USD)',
      type: 'short-input',
      placeholder: '1000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'ramp_list_transactions' },
    },
    {
      id: 'fromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: '2025-01-01T00:00:00Z',
      condition: {
        field: 'operation',
        value: ['ramp_list_transactions', 'ramp_list_reimbursements', 'ramp_list_receipts'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "start of this month" -> First day of current month at 00:00:00Z
- "30 days ago" -> Calculate 30 days before now
- "start of the quarter" -> First day of the current quarter at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start of the range (e.g., "30 days ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'toDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: '2025-12-31T23:59:59Z',
      condition: {
        field: 'operation',
        value: ['ramp_list_transactions', 'ramp_list_reimbursements', 'ramp_list_receipts'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> The current date and time
- "end of this month" -> Last day of current month at 23:59:59Z
- "yesterday" -> Yesterday at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end of the range (e.g., "now", "end of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Filter by email address',
      condition: { field: 'operation', value: 'ramp_list_users' },
    },
    {
      id: 'displayName',
      title: 'Card Display Name',
      type: 'short-input',
      placeholder: 'Filter by card display name',
      mode: 'advanced',
      condition: { field: 'operation', value: 'ramp_list_cards' },
    },
    {
      id: 'vendorId',
      title: 'Vendor ID',
      type: 'short-input',
      placeholder: 'Enter vendor ID',
      condition: { field: 'operation', value: ['ramp_list_bills', 'ramp_get_vendor'] },
      required: { field: 'operation', value: ['ramp_get_vendor'] },
    },
    {
      id: 'vendorName',
      title: 'Vendor Name',
      type: 'short-input',
      placeholder: 'Filter by vendor name',
      condition: { field: 'operation', value: 'ramp_list_vendors' },
    },
    {
      id: 'entityName',
      title: 'Entity Name',
      type: 'short-input',
      placeholder: 'Filter by entity name',
      condition: { field: 'operation', value: 'ramp_list_entities' },
    },
    // Pagination (shared across all list operations)
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      mode: 'advanced',
      condition: { field: 'operation', value: RAMP_LIST_OPERATIONS },
    },
    {
      id: 'start',
      title: 'Start Cursor',
      type: 'short-input',
      placeholder: 'ID of the last entity from the previous page',
      mode: 'advanced',
      condition: { field: 'operation', value: RAMP_LIST_OPERATIONS },
    },
  ],
  tools: {
    access: [
      'ramp_list_transactions',
      'ramp_get_transaction',
      'ramp_list_users',
      'ramp_get_user',
      'ramp_list_cards',
      'ramp_get_card',
      'ramp_list_limits',
      'ramp_get_limit',
      'ramp_list_reimbursements',
      'ramp_get_reimbursement',
      'ramp_list_bills',
      'ramp_get_bill',
      'ramp_list_departments',
      'ramp_get_department',
      'ramp_create_department',
      'ramp_list_vendors',
      'ramp_get_vendor',
      'ramp_list_entities',
      'ramp_list_spend_programs',
      'ramp_get_spend_program',
      'ramp_get_business',
      'ramp_get_business_balance',
      'ramp_list_receipts',
      'ramp_get_receipt',
      'ramp_upload_receipt',
    ],
    config: {
      tool: (params) =>
        (RAMP_OPERATIONS as readonly string[]).includes(params.operation)
          ? params.operation
          : 'ramp_list_transactions',
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.pageSize) result.pageSize = Number(params.pageSize)
        if (params.minAmount) result.minAmount = Number(params.minAmount)
        if (params.maxAmount) result.maxAmount = Number(params.maxAmount)
        const normalizedFile = normalizeFileInput(params.file, { single: true })
        if (normalizedFile) {
          result.file = normalizedFile
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Ramp OAuth credential' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    userId: { type: 'string', description: 'User ID' },
    cardId: { type: 'string', description: 'Card ID' },
    limitId: { type: 'string', description: 'Spend limit ID' },
    reimbursementId: { type: 'string', description: 'Reimbursement ID' },
    billId: { type: 'string', description: 'Bill ID' },
    receiptId: { type: 'string', description: 'Receipt ID' },
    spendProgramId: { type: 'string', description: 'Spend program ID' },
    departmentName: { type: 'string', description: 'Name of the department to create' },
    file: { type: 'json', description: 'Receipt file to upload (canonical param)' },
    departmentId: { type: 'string', description: 'Department ID' },
    state: { type: 'string', description: 'Transaction state filter' },
    merchantId: { type: 'string', description: 'Merchant ID filter' },
    minAmount: { type: 'number', description: 'Minimum transaction amount in U.S. dollars' },
    maxAmount: { type: 'number', description: 'Maximum transaction amount in U.S. dollars' },
    fromDate: { type: 'string', description: 'Start of the date range (ISO 8601)' },
    toDate: { type: 'string', description: 'End of the date range (ISO 8601)' },
    email: { type: 'string', description: 'Email address filter' },
    displayName: { type: 'string', description: 'Card display name filter' },
    vendorId: { type: 'string', description: 'Vendor ID' },
    vendorName: { type: 'string', description: 'Vendor name filter' },
    entityName: { type: 'string', description: 'Entity name filter' },
    pageSize: { type: 'number', description: 'Number of results per page (2-100)' },
    start: { type: 'string', description: 'Pagination cursor' },
  },
  outputs: {
    // List outputs
    transactions: { type: 'json', description: 'List of Ramp card transactions' },
    users: { type: 'json', description: 'List of users in the Ramp business' },
    cards: { type: 'json', description: 'List of Ramp corporate cards' },
    limits: { type: 'json', description: 'List of Ramp spend limits' },
    reimbursements: { type: 'json', description: 'List of Ramp reimbursements' },
    bills: { type: 'json', description: 'List of Ramp bills' },
    departments: { type: 'json', description: 'List of departments' },
    vendors: { type: 'json', description: 'List of Ramp vendors' },
    entities: { type: 'json', description: 'List of business entities' },
    spendPrograms: { type: 'json', description: 'List of spend programs' },
    receipts: { type: 'json', description: 'List of Ramp receipts' },
    nextStart: {
      type: 'string',
      description: 'Cursor for the next page of results (null when there are no more pages)',
    },
    // Single-resource outputs
    transaction: { type: 'json', description: 'The requested transaction' },
    user: { type: 'json', description: 'The requested user' },
    card: { type: 'json', description: 'The requested card' },
    limit: { type: 'json', description: 'The requested spend limit' },
    reimbursement: { type: 'json', description: 'The requested reimbursement' },
    bill: { type: 'json', description: 'The requested bill' },
    department: { type: 'json', description: 'The requested or created department' },
    vendor: { type: 'json', description: 'The requested vendor' },
    spendProgram: { type: 'json', description: 'The requested spend program' },
    business: { type: 'json', description: 'The authorized Ramp business' },
    balance: { type: 'json', description: 'Balance and limits of the Ramp business' },
    receipt: { type: 'json', description: 'The requested receipt' },
    // Upload output
    receiptId: { type: 'string', description: 'Unique identifier of the uploaded receipt' },
  },
}

export const RampBlockMeta = {
  tags: ['payments', 'automation'],
  templates: [
    {
      icon: RampIcon,
      title: 'Ramp spend digest to Slack',
      prompt:
        'Build a scheduled workflow that lists Ramp transactions from the last 24 hours, summarizes total spend by department and the largest purchases with an agent, and posts the digest to a finance Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RampIcon,
      title: 'Ramp receipt auto-uploader',
      prompt:
        'Create a workflow that watches a shared inbox for emailed receipts, extracts the receipt attachment, matches it to the right Ramp user by sender email with List Users, and uploads the receipt to Ramp so it attaches to the matching transaction.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: RampIcon,
      title: 'Ramp missing-receipt chaser',
      prompt:
        'Build a scheduled workflow that lists cleared Ramp transactions over $75 from the past week, filters out transactions that already have receipts, looks up each cardholder with Get User, and sends each one a Slack reminder to upload their receipt.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RampIcon,
      title: 'Ramp transactions to a table',
      prompt:
        'Create a scheduled workflow that pages through Ramp transactions since the last run using the nextStart cursor and appends each transaction with merchant, amount, state, and cardholder to a spend-tracking table for analysis.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'sync'],
    },
    {
      icon: RampIcon,
      title: 'Ramp reimbursement approvals monitor',
      prompt:
        'Build a scheduled workflow that lists Ramp reimbursements created in the last week, flags ones that have been pending longer than three days, and posts a summary with amounts and requesters to an operations Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RampIcon,
      title: 'Ramp bills due-date tracker',
      prompt:
        'Create a scheduled workflow that lists open Ramp bills, identifies bills due within the next seven days, and writes vendor, invoice number, amount, and due date to a payables table while alerting finance about anything overdue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: RampIcon,
      title: 'Ramp vendor spend review',
      prompt:
        'Build a scheduled monthly workflow that lists Ramp vendors, pulls year-to-date spend for each, asks an agent to flag vendors with unusual growth or overlapping categories, and writes the review to a vendor-management table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'audit-ramp-spend',
      description:
        'Pull Ramp transactions for a date range and summarize spend by merchant, department, or cardholder.',
      content:
        '# Audit Ramp Spend\n\nReview card spend in Ramp over a period.\n\n## Steps\n1. Call List Transactions with fromDate and toDate covering the requested period. Add userId, cardId, or departmentId filters when the question is scoped to a person, card, or team.\n2. Page through results: while nextStart is not null, call List Transactions again passing it as the start parameter.\n3. Aggregate amounts by the requested dimension (merchant, department, or cardholder) and identify outliers or policy concerns.\n\n## Output\nReport total spend, a breakdown by the requested dimension, and the largest individual transactions with merchant, amount, and date.',
    },
    {
      name: 'upload-receipt-to-ramp',
      description:
        'Upload a receipt image or PDF to Ramp and attach it to the right transaction and user.',
      content:
        '# Upload Receipt to Ramp\n\nAttach a receipt to a Ramp transaction.\n\n## Steps\n1. Identify the Ramp user the receipt belongs to. If only an email is known, call List Users with the email filter to find the user ID.\n2. If a specific transaction is known, find its ID with List Transactions (filter by user, date, or amount) or use the provided ID directly.\n3. Call Upload Receipt with the file and the user ID. Pass the transaction ID when known; otherwise Ramp will auto-match the receipt to the most relevant transaction.\n\n## Output\nReturn the uploaded receipt ID and state whether it was attached to a specific transaction or left for auto-matching.',
    },
    {
      name: 'find-ramp-transactions-missing-receipts',
      description:
        'Find cleared Ramp transactions above a threshold that have no receipts attached.',
      content:
        '# Find Ramp Transactions Missing Receipts\n\nIdentify transactions that need receipts for compliance.\n\n## Steps\n1. Call List Transactions with state CLEARED and the requested date range; use minAmount to apply the policy threshold.\n2. Page through all results using nextStart, and keep transactions whose receipts array is empty.\n3. For each match, call Get User on the cardholder user ID to get their name and email for follow-up.\n\n## Output\nReturn a list of transactions missing receipts with merchant, amount, date, and the cardholder name and email to contact.',
    },
    {
      name: 'review-ramp-bills',
      description: 'List Ramp bills, check statuses and due dates, and flag what needs payment.',
      content:
        '# Review Ramp Bills\n\nCheck the state of payables in Ramp.\n\n## Steps\n1. Call List Bills, optionally filtered by vendorId when reviewing a single vendor. Page through all results with nextStart.\n2. Group bills by status and compare due_at against today to find upcoming and overdue bills. Bill amounts are canonical: divide amount.amount by 100 for USD dollars.\n3. Use Get Bill on anything that needs line-item detail before recommending action.\n\n## Output\nReturn bills due soon and overdue bills with vendor, invoice number, amount, and due date, plus a one-line recommendation for each.',
    },
  ],
} as const satisfies BlockMeta
