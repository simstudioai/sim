import { BrexIcon } from '@/components/icons'
import { BrexBlockDisplay } from '@/blocks/blocks/brex.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { BrexResponse } from '@/tools/brex/types'

const PAGINATED_OPERATIONS = new Set([
  'list_expenses',
  'list_card_transactions',
  'list_cash_transactions',
  'list_cash_accounts',
  'list_card_statements',
  'list_cash_statements',
  'list_users',
  'list_departments',
  'list_locations',
  'list_titles',
  'list_cards',
  'list_budgets',
  'list_spend_limits',
  'list_vendors',
  'list_transfers',
])

export const BrexBlock: BlockConfig<BrexResponse> = {
  ...BrexBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Expenses
        { label: 'List Expenses', id: 'list_expenses' },
        { label: 'Get Expense', id: 'get_expense' },
        { label: 'Update Expense Memo', id: 'update_expense' },
        { label: 'Upload Receipt', id: 'upload_receipt' },
        { label: 'Match Receipt', id: 'match_receipt' },
        // Transactions & accounts
        { label: 'List Card Transactions', id: 'list_card_transactions' },
        { label: 'List Cash Transactions', id: 'list_cash_transactions' },
        { label: 'List Card Accounts', id: 'list_card_accounts' },
        { label: 'List Cash Accounts', id: 'list_cash_accounts' },
        { label: 'Get Cash Account', id: 'get_cash_account' },
        { label: 'List Card Statements', id: 'list_card_statements' },
        { label: 'List Cash Statements', id: 'list_cash_statements' },
        // Team
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Get Current User', id: 'get_current_user' },
        { label: 'List Departments', id: 'list_departments' },
        { label: 'List Locations', id: 'list_locations' },
        { label: 'List Titles', id: 'list_titles' },
        { label: 'List Cards', id: 'list_cards' },
        { label: 'Get Company', id: 'get_company' },
        // Budgets
        { label: 'List Budgets', id: 'list_budgets' },
        { label: 'Get Budget', id: 'get_budget' },
        { label: 'List Spend Limits', id: 'list_spend_limits' },
        { label: 'Get Spend Limit', id: 'get_spend_limit' },
        // Payments
        { label: 'List Vendors', id: 'list_vendors' },
        { label: 'Get Vendor', id: 'get_vendor' },
        { label: 'List Transfers', id: 'list_transfers' },
        { label: 'Get Transfer', id: 'get_transfer' },
      ],
      value: () => 'list_expenses',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Brex user token',
      required: true,
    },
    {
      id: 'expenseId',
      title: 'Expense ID',
      type: 'short-input',
      placeholder: 'ID of the expense',
      condition: {
        field: 'operation',
        value: ['get_expense', 'update_expense', 'upload_receipt'],
      },
      required: {
        field: 'operation',
        value: ['get_expense', 'update_expense', 'upload_receipt'],
      },
    },
    {
      id: 'memo',
      title: 'Memo',
      type: 'long-input',
      placeholder: 'New memo for the expense',
      condition: { field: 'operation', value: 'update_expense' },
      required: { field: 'operation', value: 'update_expense' },
    },
    {
      id: 'uploadReceiptFile',
      title: 'Receipt File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload receipt file',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: ['upload_receipt', 'match_receipt'] },
      required: { field: 'operation', value: ['upload_receipt', 'match_receipt'] },
    },
    {
      id: 'receiptFileReference',
      title: 'Receipt File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: ['upload_receipt', 'match_receipt'] },
      required: { field: 'operation', value: ['upload_receipt', 'match_receipt'] },
    },
    {
      id: 'receiptName',
      title: 'Receipt Name',
      type: 'short-input',
      placeholder: 'Receipt file name with extension (defaults to the uploaded file name)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['upload_receipt', 'match_receipt'] },
    },
    {
      id: 'accountId',
      title: 'Cash Account ID',
      type: 'short-input',
      placeholder: 'ID of the cash account (Get Cash Account defaults to primary)',
      condition: {
        field: 'operation',
        value: ['list_cash_transactions', 'list_cash_statements', 'get_cash_account'],
      },
      required: {
        field: 'operation',
        value: ['list_cash_transactions', 'list_cash_statements'],
      },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'ID of the user (optional filter for List Cards)',
      condition: { field: 'operation', value: ['get_user', 'list_cards'] },
      required: { field: 'operation', value: 'get_user' },
    },
    {
      id: 'budgetId',
      title: 'Budget ID',
      type: 'short-input',
      placeholder: 'ID of the budget',
      condition: { field: 'operation', value: 'get_budget' },
      required: { field: 'operation', value: 'get_budget' },
    },
    {
      id: 'spendLimitId',
      title: 'Spend Limit ID',
      type: 'short-input',
      placeholder: 'ID of the spend limit',
      condition: { field: 'operation', value: 'get_spend_limit' },
      required: { field: 'operation', value: 'get_spend_limit' },
    },
    {
      id: 'vendorId',
      title: 'Vendor ID',
      type: 'short-input',
      placeholder: 'ID of the vendor',
      condition: { field: 'operation', value: 'get_vendor' },
      required: { field: 'operation', value: 'get_vendor' },
    },
    {
      id: 'transferId',
      title: 'Transfer ID',
      type: 'short-input',
      placeholder: 'ID of the transfer',
      condition: { field: 'operation', value: 'get_transfer' },
      required: { field: 'operation', value: 'get_transfer' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Filter users by exact email address',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'name',
      title: 'Name Filter',
      type: 'short-input',
      placeholder: 'Filter results by name',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['list_departments', 'list_locations', 'list_titles', 'list_vendors'],
      },
    },
    {
      id: 'userIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs to filter by',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_expenses', 'list_card_transactions'] },
    },
    {
      id: 'statuses',
      title: 'Expense Statuses',
      type: 'short-input',
      placeholder: 'e.g., APPROVED, SETTLED (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_expenses' },
    },
    {
      id: 'paymentStatuses',
      title: 'Payment Statuses',
      type: 'short-input',
      placeholder: 'e.g., CLEARED, REFUNDED (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_expenses' },
    },
    {
      id: 'purchasedAtStart',
      title: 'Purchased After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g., 2026-01-01T00:00:00Z)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_expenses' },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        placeholder: 'Describe the start date (e.g., "beginning of last month")...',
      },
    },
    {
      id: 'purchasedAtEnd',
      title: 'Purchased Before',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g., 2026-02-01T00:00:00Z)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_expenses' },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        placeholder: 'Describe the end date (e.g., "end of last month")...',
      },
    },
    {
      id: 'postedAtStart',
      title: 'Posted After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g., 2026-01-01T00:00:00Z)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['list_card_transactions', 'list_cash_transactions'],
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        placeholder: 'Describe the start date (e.g., "last Monday")...',
      },
    },
    {
      id: 'memberUserIds',
      title: 'Member User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs to filter spend limits by member',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_spend_limits' },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous response',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_expenses',
          'list_card_transactions',
          'list_cash_transactions',
          'list_cash_accounts',
          'list_card_statements',
          'list_cash_statements',
          'list_users',
          'list_departments',
          'list_locations',
          'list_titles',
          'list_cards',
          'list_budgets',
          'list_spend_limits',
          'list_vendors',
          'list_transfers',
        ],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results to return (default 100; List Expenses caps at 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_expenses',
          'list_card_transactions',
          'list_cash_transactions',
          'list_cash_accounts',
          'list_card_statements',
          'list_cash_statements',
          'list_users',
          'list_departments',
          'list_locations',
          'list_titles',
          'list_cards',
          'list_budgets',
          'list_spend_limits',
          'list_vendors',
          'list_transfers',
        ],
      },
    },
  ],
  tools: {
    access: [
      'brex_list_expenses',
      'brex_get_expense',
      'brex_update_expense',
      'brex_upload_receipt',
      'brex_match_receipt',
      'brex_list_card_transactions',
      'brex_list_cash_transactions',
      'brex_list_card_accounts',
      'brex_list_cash_accounts',
      'brex_get_cash_account',
      'brex_list_card_statements',
      'brex_list_cash_statements',
      'brex_list_users',
      'brex_get_user',
      'brex_get_current_user',
      'brex_list_departments',
      'brex_list_locations',
      'brex_list_titles',
      'brex_list_cards',
      'brex_get_company',
      'brex_list_budgets',
      'brex_get_budget',
      'brex_list_spend_limits',
      'brex_get_spend_limit',
      'brex_list_vendors',
      'brex_get_vendor',
      'brex_list_transfers',
      'brex_get_transfer',
    ],
    config: {
      tool: (params) => `brex_${params.operation}`,
      params: (params) => {
        const { operation, apiKey } = params
        const result: Record<string, unknown> = { apiKey }

        switch (operation) {
          case 'list_expenses':
            if (params.userIds) result.userIds = params.userIds
            if (params.statuses) result.statuses = params.statuses
            if (params.paymentStatuses) result.paymentStatuses = params.paymentStatuses
            if (params.purchasedAtStart) result.purchasedAtStart = params.purchasedAtStart
            if (params.purchasedAtEnd) result.purchasedAtEnd = params.purchasedAtEnd
            break
          case 'get_expense':
            result.expenseId = params.expenseId
            break
          case 'update_expense':
            result.expenseId = params.expenseId
            result.memo = params.memo
            break
          case 'upload_receipt':
          case 'match_receipt': {
            const file = normalizeFileInput(params.file, { single: true })
            if (file) result.file = file
            if (operation === 'upload_receipt') result.expenseId = params.expenseId
            if (params.receiptName) result.receiptName = params.receiptName
            break
          }
          case 'list_card_transactions':
            if (params.userIds) result.userIds = params.userIds
            if (params.postedAtStart) result.postedAtStart = params.postedAtStart
            break
          case 'list_cash_transactions':
            result.accountId = params.accountId
            if (params.postedAtStart) result.postedAtStart = params.postedAtStart
            break
          case 'list_cash_statements':
            result.accountId = params.accountId
            break
          case 'get_cash_account':
            if (params.accountId) result.accountId = params.accountId
            break
          case 'list_users':
            if (params.email) result.email = params.email
            break
          case 'get_user':
            result.userId = params.userId
            break
          case 'list_cards':
            if (params.userId) result.userId = params.userId
            break
          case 'list_departments':
          case 'list_locations':
          case 'list_titles':
          case 'list_vendors':
            if (params.name) result.name = params.name
            break
          case 'list_spend_limits':
            if (params.memberUserIds) result.memberUserIds = params.memberUserIds
            break
          case 'get_budget':
            result.budgetId = params.budgetId
            break
          case 'get_spend_limit':
            result.spendLimitId = params.spendLimitId
            break
          case 'get_vendor':
            result.vendorId = params.vendorId
            break
          case 'get_transfer':
            result.transferId = params.transferId
            break
          default:
            break
        }

        if (PAGINATED_OPERATIONS.has(operation)) {
          if (params.cursor) result.cursor = String(params.cursor)
          if (params.limit) result.limit = String(params.limit)
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Brex user token' },
    expenseId: { type: 'string', description: 'Expense ID' },
    memo: { type: 'string', description: 'New memo for the expense' },
    file: { type: 'json', description: 'Receipt file to upload (canonical param)' },
    receiptName: { type: 'string', description: 'Receipt file name including extension' },
    accountId: { type: 'string', description: 'Cash account ID' },
    userId: { type: 'string', description: 'User ID' },
    budgetId: { type: 'string', description: 'Budget ID' },
    spendLimitId: { type: 'string', description: 'Spend limit ID' },
    vendorId: { type: 'string', description: 'Vendor ID' },
    transferId: { type: 'string', description: 'Transfer ID' },
    email: { type: 'string', description: 'Email filter for listing users' },
    name: { type: 'string', description: 'Name filter for departments, locations, or vendors' },
    userIds: { type: 'string', description: 'Comma-separated user IDs filter' },
    statuses: { type: 'string', description: 'Comma-separated expense statuses filter' },
    paymentStatuses: { type: 'string', description: 'Comma-separated payment statuses filter' },
    purchasedAtStart: { type: 'string', description: 'Purchased-after ISO 8601 timestamp filter' },
    purchasedAtEnd: { type: 'string', description: 'Purchased-before ISO 8601 timestamp filter' },
    postedAtStart: { type: 'string', description: 'Posted-after ISO 8601 timestamp filter' },
    memberUserIds: {
      type: 'string',
      description: 'Comma-separated member user IDs filter for spend limits',
    },
    cursor: { type: 'string', description: 'Pagination cursor' },
    limit: { type: 'string', description: 'Number of results to return' },
  },
  outputs: {
    items: { type: 'json', description: 'Items returned by list operations' },
    nextCursor: { type: 'string', description: 'Cursor for fetching the next page of results' },
    accounts: { type: 'json', description: 'Card accounts returned by List Card Accounts' },
    id: { type: 'string', description: 'ID of the fetched or updated resource' },
    memo: { type: 'string', description: 'Memo on the expense' },
    status: { type: 'string', description: 'Status of the expense or user' },
    paymentStatus: { type: 'string', description: 'Payment status of the expense' },
    expenseType: { type: 'string', description: 'Type of the expense' },
    category: { type: 'string', description: 'Merchant category of the expense' },
    merchantId: { type: 'string', description: 'Merchant ID' },
    merchant: { type: 'json', description: 'Merchant details' },
    budgetId: { type: 'string', description: 'Budget ID' },
    budget: { type: 'json', description: 'Budget details' },
    departmentId: { type: 'string', description: 'Department ID' },
    department: { type: 'json', description: 'Department details' },
    locationId: { type: 'string', description: 'Location ID' },
    location: { type: 'json', description: 'Location details' },
    userId: { type: 'string', description: 'User ID associated with the expense' },
    user: { type: 'json', description: 'User details' },
    originalAmount: { type: 'json', description: 'Original transaction amount' },
    billingAmount: { type: 'json', description: 'Amount billed to the account' },
    purchasedAmount: { type: 'json', description: 'Amount at the time of purchase' },
    usdEquivalentAmount: { type: 'json', description: 'USD equivalent amount' },
    purchasedAt: { type: 'string', description: 'Purchase timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    paymentPostedAt: { type: 'string', description: 'Timestamp the payment was posted' },
    receipts: { type: 'json', description: 'Receipts attached to the expense' },
    dashboardUrl: { type: 'string', description: 'Link to the expense in the Brex dashboard' },
    receiptId: { type: 'string', description: 'ID of the uploaded or matched receipt' },
    receiptName: { type: 'string', description: 'Name the receipt was uploaded with' },
    expenseId: { type: 'string', description: 'ID of the expense the receipt was attached to' },
    firstName: { type: 'string', description: 'First name of the user' },
    lastName: { type: 'string', description: 'Last name of the user' },
    email: { type: 'string', description: 'Email address of the user' },
    managerId: { type: 'string', description: 'Manager ID of the user' },
    titleId: { type: 'string', description: 'Title ID of the user' },
    legalName: { type: 'string', description: 'Legal name of the company' },
    mailingAddress: { type: 'json', description: 'Mailing address of the company' },
    accountType: { type: 'string', description: 'Brex account type of the company' },
    name: { type: 'string', description: 'Name of the account, budget, or spend limit' },
    currentBalance: { type: 'json', description: 'Current balance of the cash account' },
    availableBalance: { type: 'json', description: 'Available balance of the cash account' },
    accountNumber: { type: 'string', description: 'Bank account number of the cash account' },
    routingNumber: { type: 'string', description: 'Bank routing number of the cash account' },
    primary: { type: 'boolean', description: 'Whether the cash account is primary' },
    accountId: { type: 'string', description: 'Account ID of the budget or spend limit' },
    description: { type: 'string', description: 'Description of the budget or spend limit' },
    parentBudgetId: { type: 'string', description: 'Parent budget ID' },
    ownerUserIds: { type: 'json', description: 'Owner user IDs of the budget or spend limit' },
    memberUserIds: { type: 'json', description: 'Member user IDs of the spend limit' },
    periodRecurrenceType: { type: 'string', description: 'Period recurrence type' },
    spendType: { type: 'string', description: 'Spend type of the spend limit' },
    startDate: { type: 'string', description: 'Start date of the budget or spend limit' },
    endDate: { type: 'string', description: 'End date of the budget or spend limit' },
    amount: { type: 'json', description: 'Amount of the budget' },
    spendBudgetStatus: { type: 'string', description: 'Status of the budget' },
    limitType: { type: 'string', description: 'Limit type of the budget' },
    currentPeriodBalance: {
      type: 'json',
      description: 'Current period balance of the spend limit',
    },
    authorizationSettings: {
      type: 'json',
      description: 'Authorization settings of the spend limit',
    },
    companyName: { type: 'string', description: 'Company name of the vendor' },
    phone: { type: 'string', description: 'Phone number of the vendor' },
    paymentAccounts: { type: 'json', description: 'Payment accounts of the vendor' },
    counterparty: { type: 'json', description: 'Counterparty of the transfer' },
    paymentType: { type: 'string', description: 'Payment type of the transfer' },
    processDate: { type: 'string', description: 'Process date of the transfer' },
    originatingAccount: { type: 'json', description: 'Originating account of the transfer' },
    cancellationReason: { type: 'string', description: 'Cancellation reason of the transfer' },
    estimatedDeliveryDate: {
      type: 'string',
      description: 'Estimated delivery date of the transfer',
    },
    creatorUserId: { type: 'string', description: 'ID of the user who created the transfer' },
    createdAt: { type: 'string', description: 'Creation timestamp of the transfer' },
    displayName: { type: 'string', description: 'Display name of the transfer' },
    externalMemo: { type: 'string', description: 'External memo of the transfer' },
  },
}

export const BrexBlockMeta = {
  tags: ['payments'],
  url: 'https://www.brex.com',
  templates: [
    {
      icon: BrexIcon,
      title: 'Brex receipt auto-attach',
      prompt:
        'Build a workflow that takes an uploaded receipt file and sends it to Brex with the Match Receipt operation so Brex automatically pairs it with the right card expense.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: BrexIcon,
      title: 'Brex daily expense digest',
      prompt:
        'Build a scheduled workflow that runs every weekday morning, lists Brex expenses settled in the last 24 hours, summarizes total spend by merchant category, and posts the digest to a Slack channel.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrexIcon,
      title: 'Brex memo enforcer',
      prompt:
        'Build a scheduled workflow that lists approved Brex expenses, finds ones missing a memo, has an agent draft a memo from the merchant and amount details, and updates each expense with the drafted memo.',
      modules: ['agent', 'workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: BrexIcon,
      title: 'Brex spend anomaly alert',
      prompt:
        'Build a scheduled workflow that lists recent Brex card transactions, flags any transaction above a configurable threshold, and emails the finance team a report of flagged transactions with merchant details.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: BrexIcon,
      title: 'Brex cash balance monitor',
      prompt:
        'Build a scheduled workflow that checks Brex cash account balances every morning and sends a Slack alert when the available balance of any account drops below a set threshold.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrexIcon,
      title: 'Brex budget utilization report',
      prompt:
        'Build a weekly workflow that lists Brex budgets and spend limits, computes utilization for each budget from its amount and current period balance, stores the results in a table, and emails a summary report.',
      modules: ['workflows', 'scheduled', 'tables'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: BrexIcon,
      title: 'Brex team directory assistant',
      prompt:
        'Build an agent that answers questions about company spend and team structure by looking up Brex users, departments, locations, and their expenses on demand.',
      modules: ['agent'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: BrexIcon,
      title: 'Brex vendor payment tracker',
      prompt:
        'Build a workflow that lists Brex vendors and recent transfers, reconciles transfer statuses against expected payments stored in a table, and flags any failed or delayed payments.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'spend-report',
      description:
        'Summarize Brex spend over a period, broken down by category, merchant, and user.',
      content:
        '# Spend Report\n\nBuild a clear summary of company spend from Brex expenses.\n\n## Steps\n1. List expenses filtered to the requested period using the purchased-at date filters.\n2. Group expenses by merchant category, merchant, and user, totaling billing amounts (amounts are in cents).\n3. Highlight the largest expenses and any with OUT_OF_POLICY status.\n\n## Output\nReturn total spend, a breakdown by category and merchant, the top spenders, and any flagged out-of-policy expenses with dashboard links.',
    },
    {
      name: 'attach-receipt',
      description: 'Upload a receipt file and attach it to the right Brex expense.',
      content:
        '# Attach a Receipt\n\nGet a receipt onto the correct Brex expense.\n\n## Steps\n1. If the target expense is known, use Upload Receipt with the expense ID.\n2. If not, use Match Receipt so Brex pairs the receipt with the right expense automatically.\n3. Confirm the upload succeeded and capture the receipt ID.\n\n## Output\nReturn the receipt ID, the receipt name, and the expense it was attached to (or note that Brex is matching it automatically).',
    },
    {
      name: 'memo-cleanup',
      description: 'Find Brex expenses missing memos and fill them in from merchant details.',
      content:
        '# Memo Cleanup\n\nKeep expense memos complete for accounting.\n\n## Steps\n1. List recent expenses and find ones with an empty memo.\n2. For each, draft a short memo from the merchant descriptor, category, and amount.\n3. Update each expense with the drafted memo using Update Expense Memo.\n\n## Output\nReturn the list of expenses updated, each with its new memo, and any expenses that could not be updated.',
    },
    {
      name: 'budget-utilization',
      description: 'Report utilization for Brex budgets and spend limits.',
      content:
        '# Budget Utilization\n\nShow how much of each budget and spend limit has been used.\n\n## Steps\n1. List budgets and capture each amount and status.\n2. List spend limits and capture each current period balance.\n3. Compute utilization where both an amount and a balance are available (amounts are in cents).\n\n## Output\nReturn each budget and spend limit with its owner, period, amount, and utilization, flagging any that are near or over their limit.',
    },
    {
      name: 'cash-balance-check',
      description: 'Check Brex cash account balances and recent account activity.',
      content:
        '# Cash Balance Check\n\nGive a quick read on company cash in Brex.\n\n## Steps\n1. List cash accounts and capture current and available balances (amounts are in cents).\n2. For the primary account, list recent cash transactions.\n3. Note any unusually large recent movements.\n\n## Output\nReturn each account with its balances, the most recent transactions for the primary account, and any large movements worth a look.',
    },
    {
      name: 'statement-reconciliation',
      description: 'Reconcile a Brex card statement period against its settled transactions.',
      content:
        '# Statement Reconciliation\n\nTie a card statement back to its underlying transactions.\n\n## Steps\n1. List card statements and pick the period to reconcile.\n2. List card transactions posted within that period using the posted-at filter.\n3. Compare transaction totals to the statement start and end balances and flag gaps.\n\n## Output\nReturn the statement period, its balances, the transaction total for the period, and any discrepancy that needs review.',
    },
  ],
} as const satisfies BlockMeta
