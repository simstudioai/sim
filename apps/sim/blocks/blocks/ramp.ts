import { RampIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const RampBlock: BlockConfig = {
  type: 'ramp',
  name: 'Ramp',
  description: 'Read spend, bills, cards, and reimbursements, and add transaction memos in Ramp',
  longDescription:
    'Connect Ramp to your agents to review company balances, employees, card transactions, physical and virtual cards, vendors, bills, and reimbursements. Add transaction memos and paginate through records with up to 100 results per request.',
  docsLink: 'https://docs.sim.ai/integrations/ramp',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  authMode: AuthMode.OAuth,
  bgColor: '#E4F222',
  icon: RampIcon,
  canvasPresentation: {
    defaultTitle: 'Ramp',
    sentences: {
      byOperation: {
        get_business: ['Read business'],
        get_balance: ['Read balance'],
        list_users: ['List users'],
        get_user: [{ text: 'Read user', field: 'user_id', core: true }],
        list_transactions: ['List transactions'],
        get_transaction: [{ text: 'Read transaction', field: 'transaction_id', core: true }],
        list_physical_cards: ['List physical cards'],
        get_physical_card: [{ text: 'Read physical card', field: 'card_id', core: true }],
        list_virtual_cards: ['List virtual cards'],
        get_virtual_card: [{ text: 'Read virtual card', field: 'card_id', core: true }],
        list_vendors: ['List vendors'],
        get_vendor: [{ text: 'Read vendor', field: 'vendor_id', core: true }],
        list_bills: ['List bills'],
        get_bill: [{ text: 'Read bill', field: 'bill_id', core: true }],
        list_reimbursements: ['List reimbursements'],
        get_reimbursement: [{ text: 'Read reimbursement', field: 'reimbursement_id', core: true }],
        get_memo: [{ text: 'Read memo for transaction', field: 'transaction_id', core: true }],
        create_memo: [
          { text: 'Add memo', field: 'memo', core: true },
          { text: 'to transaction', field: 'transaction_id', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      value: () => 'list_transactions',
      options: [
        { label: 'Get Business', id: 'get_business' },
        { label: 'Get Balance', id: 'get_balance' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'List Transactions', id: 'list_transactions' },
        { label: 'Get Transaction', id: 'get_transaction' },
        { label: 'List Physical Cards', id: 'list_physical_cards' },
        { label: 'Get Physical Card', id: 'get_physical_card' },
        { label: 'List Virtual Cards', id: 'list_virtual_cards' },
        { label: 'Get Virtual Card', id: 'get_virtual_card' },
        { label: 'List Vendors', id: 'list_vendors' },
        { label: 'Get Vendor', id: 'get_vendor' },
        { label: 'List Bills', id: 'list_bills' },
        { label: 'Get Bill', id: 'get_bill' },
        { label: 'List Reimbursements', id: 'list_reimbursements' },
        { label: 'Get Reimbursement', id: 'get_reimbursement' },
        { label: 'Get Memo', id: 'get_memo' },
        { label: 'Create Memo', id: 'create_memo' },
      ],
    },
    {
      id: 'credential',
      title: 'Ramp account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'ramp',
      requiredScopes: getScopesForService('ramp'),
      required: true,
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_users'] },
      required: false,
      placeholder: 'Enter employee email',
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_users'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Any', id: '' },
        { label: 'User Active', id: 'USER_ACTIVE' },
        { label: 'User Draft', id: 'USER_DRAFT' },
        { label: 'User Inactive', id: 'USER_INACTIVE' },
        { label: 'User Suspended', id: 'USER_SUSPENDED' },
      ],
      value: () => '',
    },
    {
      id: 'department_id',
      title: 'Department ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_users', 'list_transactions'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter department id',
    },
    {
      id: 'entity_id',
      title: 'Entity ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_users', 'list_virtual_cards'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter entity id',
    },
    {
      id: 'start',
      title: 'Pagination cursor',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'list_users',
          'list_transactions',
          'list_physical_cards',
          'list_virtual_cards',
          'list_vendors',
          'list_bills',
          'list_reimbursements',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter nextCursor from a previous page',
    },
    {
      id: 'page_size',
      title: 'Page size',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'list_users',
          'list_transactions',
          'list_physical_cards',
          'list_virtual_cards',
          'list_vendors',
          'list_bills',
          'list_reimbursements',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Defaults to 20 (2 to 100)',
    },
    {
      id: 'user_id',
      title: 'User ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'get_user',
          'list_transactions',
          'list_physical_cards',
          'list_virtual_cards',
          'list_reimbursements',
        ],
      },
      required: { field: 'operation', value: ['get_user'] },
      placeholder: 'Enter user id',
    },
    {
      id: 'from_date',
      title: 'From date',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_transactions', 'list_reimbursements'] },
      required: false,
      mode: 'advanced',
      placeholder: '2026-01-01T00:00:00Z',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp for the requested date. Return ONLY the timestamp.',
        placeholder: 'Describe the date and time',
      },
    },
    {
      id: 'to_date',
      title: 'To date',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_transactions', 'list_reimbursements'] },
      required: false,
      mode: 'advanced',
      placeholder: '2026-01-01T00:00:00Z',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp for the requested date. Return ONLY the timestamp.',
        placeholder: 'Describe the date and time',
      },
    },
    {
      id: 'transaction_state',
      title: 'State',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_transactions'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Any', id: '' },
        { label: 'All', id: 'ALL' },
        { label: 'Cleared', id: 'CLEARED' },
        { label: 'Completion', id: 'COMPLETION' },
        { label: 'Declined', id: 'DECLINED' },
        { label: 'Error', id: 'ERROR' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Pending Initiation', id: 'PENDING_INITIATION' },
      ],
      value: () => '',
    },
    {
      id: 'reimbursement_state',
      title: 'State',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_reimbursements'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Any', id: '' },
        { label: 'Approved', id: 'APPROVED' },
        { label: 'Awaiting Export', id: 'AWAITING_EXPORT' },
        { label: 'Awaiting Payment', id: 'AWAITING_PAYMENT' },
        { label: 'Awaiting Push Payment', id: 'AWAITING_PUSH_PAYMENT' },
        { label: 'Canceled', id: 'CANCELED' },
        { label: 'Deleted', id: 'DELETED' },
        { label: 'Draft', id: 'DRAFT' },
        { label: 'Exported', id: 'EXPORTED' },
        { label: 'Export Failed', id: 'EXPORT_FAILED' },
        { label: 'Export Initiated', id: 'EXPORT_INITIATED' },
        { label: 'Export Marked As Failed', id: 'EXPORT_MARKED_AS_FAILED' },
        { label: 'Export Successful', id: 'EXPORT_SUCCESSFUL' },
        { label: 'Failed Reimbursement', id: 'FAILED_REIMBURSEMENT' },
        { label: 'Init', id: 'INIT' },
        { label: 'Manually Reimbursed', id: 'MANUALLY_REIMBURSED' },
        { label: 'Missing Ach', id: 'MISSING_ACH' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Processing', id: 'PROCESSING' },
        { label: 'Push Payment Failed', id: 'PUSH_PAYMENT_FAILED' },
        { label: 'Push Payment Initiated', id: 'PUSH_PAYMENT_INITIATED' },
        { label: 'Reimbursed', id: 'REIMBURSED' },
        { label: 'Reimbursed Via Push', id: 'REIMBURSED_VIA_PUSH' },
        { label: 'Rejected', id: 'REJECTED' },
      ],
      value: () => '',
    },
    {
      id: 'sync_status',
      title: 'Sync status',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_transactions', 'list_reimbursements'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Any', id: '' },
        { label: 'Not Sync Ready', id: 'NOT_SYNC_READY' },
        { label: 'Synced', id: 'SYNCED' },
        { label: 'Sync Ready', id: 'SYNC_READY' },
      ],
      value: () => '',
    },
    {
      id: 'transaction_id',
      title: 'Transaction ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_transaction', 'get_memo', 'create_memo'] },
      required: true,
      placeholder: 'Enter transaction id',
    },
    {
      id: 'display_name',
      title: 'Display name',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_physical_cards'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter display name',
    },
    {
      id: 'card_id',
      title: 'Card ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_physical_card', 'get_virtual_card'] },
      required: true,
      placeholder: 'Enter card id',
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_vendors'] },
      required: false,
      placeholder: 'Enter name',
    },
    {
      id: 'external_vendor_id',
      title: 'External vendor ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_vendors'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter external vendor id',
    },
    {
      id: 'vendor_owner_id',
      title: 'Vendor owner ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_vendors'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter vendor owner id',
    },
    {
      id: 'vendor_id',
      title: 'Vendor ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_vendor', 'list_bills'] },
      required: { field: 'operation', value: ['get_vendor'] },
      placeholder: 'Enter vendor id',
    },
    {
      id: 'payment_status',
      title: 'Payment status',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_bills'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Any', id: '' },
        { label: 'Open', id: 'OPEN' },
        { label: 'Paid', id: 'PAID' },
      ],
      value: () => '',
    },
    {
      id: 'approval_status',
      title: 'Approval status',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_bills'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Any', id: '' },
        { label: 'Approved', id: 'APPROVED' },
        { label: 'Initialized', id: 'INITIALIZED' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Rejected', id: 'REJECTED' },
        { label: 'Terminated', id: 'TERMINATED' },
      ],
      value: () => '',
    },
    {
      id: 'from_due_date',
      title: 'From due date',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_bills'] },
      required: false,
      mode: 'advanced',
      placeholder: '2026-01-01T00:00:00Z',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp for the requested date. Return ONLY the timestamp.',
        placeholder: 'Describe the date and time',
      },
    },
    {
      id: 'to_due_date',
      title: 'To due date',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_bills'] },
      required: false,
      mode: 'advanced',
      placeholder: '2026-01-01T00:00:00Z',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp for the requested date. Return ONLY the timestamp.',
        placeholder: 'Describe the date and time',
      },
    },
    {
      id: 'bill_id',
      title: 'Bill ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_bill'] },
      required: true,
      placeholder: 'Enter bill id',
    },
    {
      id: 'reimbursement_id',
      title: 'Reimbursement ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_reimbursement'] },
      required: true,
      placeholder: 'Enter reimbursement id',
    },
    {
      id: 'memo',
      title: 'Memo',
      type: 'long-input',
      condition: { field: 'operation', value: ['create_memo'] },
      required: true,
      placeholder: 'Enter the business purpose of the transaction',
    },
    {
      id: 'is_memo_recurring',
      title: 'Apply to similar future transactions (deprecated)',
      type: 'switch',
      condition: { field: 'operation', value: ['create_memo'] },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'ramp_get_business',
      'ramp_get_balance',
      'ramp_list_users',
      'ramp_get_user',
      'ramp_list_transactions',
      'ramp_get_transaction',
      'ramp_list_physical_cards',
      'ramp_get_physical_card',
      'ramp_list_virtual_cards',
      'ramp_get_virtual_card',
      'ramp_list_vendors',
      'ramp_get_vendor',
      'ramp_list_bills',
      'ramp_get_bill',
      'ramp_list_reimbursements',
      'ramp_get_reimbursement',
      'ramp_get_memo',
      'ramp_create_memo',
    ],
    config: {
      tool: (params) => `ramp_${params.operation || 'list_transactions'}`,
      params: (params) => ({
        page_size:
          params.page_size === '' || params.page_size == null
            ? undefined
            : Number(params.page_size),
        is_memo_recurring:
          params.is_memo_recurring === '' || params.is_memo_recurring == null
            ? undefined
            : params.is_memo_recurring === true || params.is_memo_recurring === 'true',
        status: params.status === '' ? undefined : params.status,
        sync_status: params.sync_status === '' ? undefined : params.sync_status,
        approval_status: params.approval_status === '' ? undefined : params.approval_status,
        payment_status: params.payment_status === '' ? undefined : params.payment_status,
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Connected Ramp account' },
    email: { type: 'string', description: 'filter by email' },
    status: {
      type: 'string',
      description:
        'Filter only for users with the given status. Defaults to returning all active and inactive users, but not suspended users',
    },
    department_id: { type: 'string', description: 'filter by department' },
    entity_id: { type: 'string', description: 'filter by business entity' },
    start: { type: 'string', description: 'Next cursor from the previous response' },
    page_size: { type: 'number', description: 'Results per page, from 2 to 100 (default 20)' },
    user_id: { type: 'string', description: 'User id' },
    from_date: {
      type: 'string',
      description:
        'Filter for transactions with a `user_transaction_time` after the given date, in ISO8601 format.',
    },
    to_date: {
      type: 'string',
      description:
        'Filter for transactions with a `user_transaction_time` before the given date, in ISO8601 format.',
    },
    transaction_state: {
      type: 'string',
      description:
        "Filter by transaction state. If set to 'ALL', all transactions including 'DECLINED' will be listed.",
    },
    reimbursement_state: { type: 'string', description: 'Filter by reimbursement state' },
    sync_status: {
      type: 'string',
      description:
        'Filter for transactions by sync status. If set, it supersedes sync_ready and has_no_sync_commits',
    },
    transaction_id: { type: 'string', description: 'Transaction id' },
    display_name: { type: 'string', description: 'Filter by display name.' },
    card_id: { type: 'string', description: 'Card id' },
    name: { type: 'string', description: 'Filter by name' },
    external_vendor_id: {
      type: 'string',
      description:
        'Filter by customer-defined external vendor ID. This is independent of accounting system remote IDs.',
    },
    vendor_owner_id: {
      type: 'string',
      description: 'Unique identifier of the user which owns this vendor.',
    },
    vendor_id: { type: 'string', description: 'Vendor id' },
    payment_status: { type: 'string', description: 'List bills of the provided payment status.' },
    approval_status: {
      type: 'string',
      description:
        'List bills of the provided bill approval status. Note that this is separate from the approval status for payment release.',
    },
    from_due_date: {
      type: 'string',
      description:
        'Shows only bills with a due_at on or after this date. This parameter should be provided as a datetime string that conforms to ISO 8601',
    },
    to_due_date: {
      type: 'string',
      description:
        'Shows only bills with a due_at on or before this date. This parameter should be provided as a datetime string that conforms to ISO 8601',
    },
    bill_id: { type: 'string', description: 'Bill id' },
    reimbursement_id: { type: 'string', description: 'Reimbursement id' },
    memo: { type: 'string', description: 'Transaction memo text (maximum 255 characters)' },
    is_memo_recurring: {
      type: 'boolean',
      description: 'Apply the memo to similar future transactions (deprecated by Ramp)',
    },
  },
  outputs: {
    business: {
      type: 'json',
      description:
        'business (id, business_name_legal, business_name_on_card, active, created_time, website, is_reimbursements_enabled, initial_approved_limit_amount)',
    },
    balance: {
      type: 'json',
      description:
        'balance (card_limit_amount, available_card_limit_amount, card_balance_including_pending_amount, card_balance_excluding_pending_amount, statement_balance_amount, next_billing_date, prev_billing_date)',
    },
    users: {
      type: 'json',
      description:
        'List of users (id, first_name, last_name, email, role, status, employee_id, department_id, location_id, manager_id, entity_id, is_manager)',
    },
    user: {
      type: 'json',
      description:
        'user (id, first_name, last_name, email, role, status, employee_id, department_id, location_id, manager_id, entity_id, is_manager)',
    },
    transactions: {
      type: 'json',
      description:
        'List of transactions (id, entity_amount, merchant_amount, merchant_name, merchant_descriptor, merchant_category_code, memo, state, card_id, card_holder, user_transaction_time, settlement_date, all_requirements_met_and_approved, sync_status, entity_id, updated_at)',
    },
    transaction: {
      type: 'json',
      description:
        'transaction (id, entity_amount, merchant_amount, merchant_name, merchant_descriptor, merchant_category_code, memo, state, card_id, card_holder, user_transaction_time, settlement_date, all_requirements_met_and_approved, sync_status, entity_id, updated_at)',
    },
    physicalCards: {
      type: 'json',
      description:
        'List of physicalCards (id, cardholder_id, cardholder_name, display_name, last_four, state, is_suspended, fund_id, created_at)',
    },
    physicalCard: {
      type: 'json',
      description:
        'physicalCard (id, cardholder_id, cardholder_name, display_name, last_four, state, is_suspended, fund_id, created_at)',
    },
    virtualCards: {
      type: 'json',
      description: 'List of virtualCards (id, user_id, fund_id, is_card_suspended, created_at)',
    },
    virtualCard: {
      type: 'json',
      description: 'virtualCard (id, user_id, fund_id, is_card_suspended, created_at)',
    },
    vendors: {
      type: 'json',
      description:
        'List of vendors (id, name, name_legal, description, is_active, external_vendor_id, accounting_vendor_remote_id, vendor_owner_id, country, created_at, total_spend_all_time, total_spend_last_30_days, total_spend_ytd)',
    },
    vendor: {
      type: 'json',
      description:
        'vendor (id, name, name_legal, description, is_active, external_vendor_id, accounting_vendor_remote_id, vendor_owner_id, country, created_at, total_spend_all_time, total_spend_last_30_days, total_spend_ytd)',
    },
    bills: {
      type: 'json',
      description:
        'List of bills (id, invoice_number, amount, vendor, memo, status, status_summary, approval_status, sync_status, due_at, issued_at, paid_at, created_at, entity_id)',
    },
    bill: {
      type: 'json',
      description:
        'bill (id, invoice_number, amount, vendor, memo, status, status_summary, approval_status, sync_status, due_at, issued_at, paid_at, created_at, entity_id)',
    },
    reimbursements: {
      type: 'json',
      description:
        'List of reimbursements (id, user_id, user_email, user_full_name, entity_amount, merchant_amount, merchant, memo, state, direction, type, transaction_date, created_at, submitted_at, approved_at, payment_processed_at, sync_status, entity_id)',
    },
    reimbursement: {
      type: 'json',
      description:
        'reimbursement (id, user_id, user_email, user_full_name, entity_amount, merchant_amount, merchant, memo, state, direction, type, transaction_date, created_at, submitted_at, approved_at, payment_processed_at, sync_status, entity_id)',
    },
    memo: { type: 'json', description: 'memo (id, memo)' },
    nextCursor: { type: 'string', description: 'Cursor for the next page of list results' },
    nextPageUrl: { type: 'string', description: 'Ramp URL for the next page of list results' },
  },
}

export const RampBlockMeta = {
  tags: ['payments', 'data-analytics', 'automation'],
  url: 'https://ramp.com',
  templates: [
    {
      icon: RampIcon,
      title: 'Weekly Spend Review',
      prompt:
        'Every week, read Ramp transactions for the previous week, group spending by merchant and currency, and produce a summary with unusually large expenses and transaction IDs.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: RampIcon,
      title: 'Reimbursement Review Queue',
      prompt:
        'Each morning, list pending Ramp reimbursements, read the details needed for review, and produce a queue with employee names, amounts, merchants, and submission dates.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: RampIcon,
      title: 'Upcoming Bill Report',
      prompt:
        'Each day, list open Ramp bills due in the next seven days and produce a report grouped by vendor, currency, approval status, and due date.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: RampIcon,
      title: 'Vendor Spend Summary',
      prompt:
        'At month end, list Ramp vendors and compare their last 30 days and year-to-date spend. Produce a ranked vendor report with vendor IDs and currencies.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: RampIcon,
      title: 'Employee Card Inventory',
      prompt:
        'When given an employee email, find the Ramp user, list their physical and virtual cards, and return an inventory with card status and suspension flags.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: RampIcon,
      title: 'Transaction Memo Assistant',
      prompt:
        'When a finance reviewer supplies a transaction ID and approved business purpose, read the transaction and its memo, add the supplied memo in Ramp, and return the saved memo.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: RampIcon,
      title: 'Available Credit Snapshot',
      prompt:
        'Each business morning, read the Ramp business and balance, and produce a snapshot of the card limit, available card spending, statement balance, and next billing date.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: RampIcon,
      title: 'Accounting Close Review',
      prompt:
        'Before month end, list Ramp transactions with accounting sync status SYNC_READY and reimbursements ready to sync, and produce a checklist with IDs and amounts for the accounting team.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'summarize-card-spend',
      description: 'Summarize card spending by merchant and currency for a requested time window.',
      content:
        '# Summarize Card Spend\n\nSummarize card spending by merchant and currency for a requested time window.\n\n## Steps\n1. Use list_transactions with from_date and to_date for the requested time window.\n2. Read additional pages only within an explicit page budget, passing nextCursor as start.\n3. Group entity_amount.value by entity_amount.currency and merchant; keep refunds signed.\n\n## Output\nReturn totals per currency, covered dates, transaction IDs for exceptions, and whether more pages remain.',
    },
    {
      name: 'review-pending-reimbursements',
      description: 'Prepare a reimbursement review queue with employee and expense context.',
      content:
        '# Review Pending Reimbursements\n\nPrepare a reimbursement review queue with employee and expense context.\n\n## Steps\n1. Use list_reimbursements with state PENDING.\n2. Fetch selected reimbursement details and corresponding users when more context is needed.\n3. Summarize employee, merchant, memo, submitted date, and entity_amount.\n\n## Output\nReturn a review queue with reimbursement IDs and currency-aware amounts; retain unknown values as unknown.',
    },
    {
      name: 'review-upcoming-bills',
      description: 'Identify unpaid vendor bills due within a specified time window.',
      content:
        '# Review Upcoming Bills\n\nIdentify unpaid vendor bills due within a specified time window.\n\n## Steps\n1. Use list_bills with payment_status OPEN and the requested from_due_date and to_due_date.\n2. Read selected bill details and vendor details when additional context is needed.\n3. Group bills by vendor and approval_status while keeping currencies separate.\n\n## Output\nReturn due dates, invoice numbers, bill IDs, approval status, and amounts for review.',
    },
    {
      name: 'analyze-vendor-spend',
      description: 'Compare vendor spend over the last 30 days and year to date.',
      content:
        '# Analyze Vendor Spend\n\nCompare vendor spend over the last 30 days and year to date.\n\n## Steps\n1. List vendors using a bounded page budget.\n2. Read vendor details for vendors requiring investigation.\n3. Compare total_spend_last_30_days and total_spend_ytd using their currency codes.\n\n## Output\nReturn a ranked report with vendor IDs, time periods, currencies, and any incomplete pagination.',
    },
    {
      name: 'inventory-employee-cards',
      description: 'Inspect the physical and virtual cards assigned to an employee.',
      content:
        '# Inventory Employee Cards\n\nInspect the physical and virtual cards assigned to an employee.\n\n## Steps\n1. Look up the employee with list_users filtered by email.\n2. List physical and virtual cards using the employee user_id.\n3. Read selected card details and summarize each suspension flag and physical-card state.\n\n## Output\nReturn card IDs, physical-card last four digits, and suspension status without implying a card was changed.',
    },
    {
      name: 'document-transaction-purpose',
      description: 'Attach a supplied business purpose to a card transaction.',
      content:
        '# Document Transaction Purpose\n\nAttach a supplied business purpose to a card transaction.\n\n## Steps\n1. Read the transaction and current memo for the supplied transaction ID.\n2. Use the user-provided business purpose; obtain missing facts instead of inventing them.\n3. Call create_memo with the supplied purpose and recurring behavior only when requested.\n\n## Output\nReturn the transaction ID and saved memo.',
    },
    {
      name: 'inspect-credit-availability',
      description: 'Summarize the business card balance and remaining spending capacity.',
      content:
        '# Inspect Credit Availability\n\nSummarize the business card balance and remaining spending capacity.\n\n## Steps\n1. Fetch the business identity and balance.\n2. Compare card_limit_amount and available_card_limit_amount, respecting currency codes and minor_unit_conversion_rate.\n3. Include statement_balance_amount and next_billing_date in the summary.\n\n## Output\nReturn a dated balance snapshot, retaining null amounts as unavailable.',
    },
  ],
} as const satisfies BlockMeta
