import { SapConcurIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SapConcurProxyResponse, UserFileLike } from '@/tools/sap_concur/types'

const toBool = (v: unknown): boolean | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.toLowerCase() === 'true'
  return Boolean(v)
}

const REPORT_USER_OPS = [
  'sap_concur_get_expense_report',
  'sap_concur_create_expense_report',
  'sap_concur_update_expense_report',
  'sap_concur_submit_expense_report',
  'sap_concur_recall_expense_report',
  'sap_concur_list_expenses',
  'sap_concur_get_expense',
  'sap_concur_get_itemizations',
  'sap_concur_list_allocations',
  'sap_concur_get_allocation',
  'sap_concur_update_allocation',
  'sap_concur_list_attendee_associations',
  'sap_concur_associate_attendees',
  'sap_concur_remove_all_attendees',
  'sap_concur_list_report_comments',
  'sap_concur_create_report_comment',
  'sap_concur_list_exceptions',
  'sap_concur_create_quick_expense',
  'sap_concur_create_quick_expense_with_image',
  'sap_concur_list_receipts',
  'sap_concur_list_reports_to_approve',
  'sap_concur_upload_receipt_image',
]

const REPORT_GET_CONTEXT_TYPE_OPS = ['sap_concur_get_expense_report']

const EXPENSE_READ_CONTEXT_TYPE_OPS = [
  'sap_concur_get_expense',
  'sap_concur_list_exceptions',
  'sap_concur_list_report_comments',
  'sap_concur_create_report_comment',
]

const TRAVELER_ONLY_CONTEXT_TYPE_OPS = [
  'sap_concur_list_expenses',
  'sap_concur_get_itemizations',
  'sap_concur_create_quick_expense',
  'sap_concur_create_quick_expense_with_image',
]

const ATTENDEE_CONTEXT_TYPE_OPS = [
  'sap_concur_list_attendee_associations',
  'sap_concur_associate_attendees',
  'sap_concur_remove_all_attendees',
]

const ALLOCATION_CONTEXT_TYPE_OPS = [
  'sap_concur_get_allocation',
  'sap_concur_update_allocation',
  'sap_concur_recall_expense_report',
  'sap_concur_create_expense_report',
  'sap_concur_update_expense_report',
]

const LIST_ALLOCATIONS_CONTEXT_TYPE_OPS = ['sap_concur_list_allocations']

/** Every `contextType` subBlock variant shares one state key, so a value picked under one
 * operation survives a switch to an operation whose dropdown never offered it. This maps each
 * operation to the values its own dropdown exposes so the stored value can be clamped. */
const CONTEXT_TYPE_ALLOWED_VALUES: Record<string, readonly string[]> = {}
for (const [ops, allowed] of [
  [REPORT_GET_CONTEXT_TYPE_OPS, ['TRAVELER', 'MANAGER', 'PROCESSOR', 'PROXY']],
  [EXPENSE_READ_CONTEXT_TYPE_OPS, ['TRAVELER', 'MANAGER', 'PROXY']],
  [TRAVELER_ONLY_CONTEXT_TYPE_OPS, ['TRAVELER']],
  [LIST_ALLOCATIONS_CONTEXT_TYPE_OPS, ['TRAVELER', 'MANAGER']],
  [ALLOCATION_CONTEXT_TYPE_OPS, ['TRAVELER', 'PROXY']],
  [ATTENDEE_CONTEXT_TYPE_OPS, ['TRAVELER', 'PROXY']],
] as const) {
  for (const op of ops) CONTEXT_TYPE_ALLOWED_VALUES[op] = allowed
}

/** Default context every operation's dropdown offers. */
const DEFAULT_CONTEXT_TYPE = 'TRAVELER'

/** Clamps the shared `contextType` state to the values the given operation actually accepts. */
const clampContextType = (operation: unknown, value: unknown): string => {
  const allowed = CONTEXT_TYPE_ALLOWED_VALUES[String(operation)]
  if (!allowed) return DEFAULT_CONTEXT_TYPE
  return typeof value === 'string' && allowed.includes(value) ? value : DEFAULT_CONTEXT_TYPE
}

/** List Lists and List List Items share one `sortBy` state key but accept disjoint sort fields,
 * so a value picked under one operation is illegal under the other and must be clamped away. */
const SORT_BY_ALLOWED_VALUES: Record<string, readonly string[]> = {
  sap_concur_list_lists: ['name', 'levelcount', 'listcategory'],
  sap_concur_list_list_items: ['value', 'shortCode'],
}

/** Clamps the shared `sortBy` state to the fields the given operation accepts, else unset. */
const clampSortBy = (operation: unknown, value: unknown): string | undefined => {
  const allowed = SORT_BY_ALLOWED_VALUES[String(operation)]
  if (!allowed || typeof value !== 'string' || !allowed.includes(value)) return undefined
  return value
}

const REPORT_ID_OPS = [
  'sap_concur_get_expense_report',
  'sap_concur_update_expense_report',
  'sap_concur_delete_expense_report',
  'sap_concur_submit_expense_report',
  'sap_concur_recall_expense_report',
  'sap_concur_approve_expense_report',
  'sap_concur_send_back_expense_report',
  'sap_concur_list_expenses',
  'sap_concur_get_expense',
  'sap_concur_get_itemizations',
  'sap_concur_update_expense',
  'sap_concur_delete_expense',
  'sap_concur_list_allocations',
  'sap_concur_get_allocation',
  'sap_concur_update_allocation',
  'sap_concur_list_attendee_associations',
  'sap_concur_associate_attendees',
  'sap_concur_remove_all_attendees',
  'sap_concur_list_report_comments',
  'sap_concur_create_report_comment',
  'sap_concur_list_exceptions',
]

const EXPENSE_ID_OPS = [
  'sap_concur_get_expense',
  'sap_concur_get_itemizations',
  'sap_concur_update_expense',
  'sap_concur_delete_expense',
  'sap_concur_list_allocations',
  'sap_concur_list_attendee_associations',
  'sap_concur_associate_attendees',
  'sap_concur_remove_all_attendees',
]

const REQUEST_UUID_OPS = [
  'sap_concur_get_travel_request',
  'sap_concur_update_travel_request',
  'sap_concur_delete_travel_request',
  'sap_concur_move_travel_request',
  'sap_concur_list_travel_request_comments',
  'sap_concur_create_expected_expense',
  'sap_concur_list_expected_expenses',
]

const RECEIPT_UPLOAD_OPS = [
  'sap_concur_upload_receipt_image',
  'sap_concur_create_quick_expense_with_image',
]

const LIST_ITEM_ID_OPS = [
  'sap_concur_get_list_item',
  'sap_concur_update_list_item',
  'sap_concur_delete_list_item',
]

const BODY_OPS = [
  'sap_concur_create_expense_report',
  'sap_concur_update_expense_report',
  'sap_concur_approve_expense_report',
  'sap_concur_send_back_expense_report',
  'sap_concur_update_expense',
  'sap_concur_update_allocation',
  'sap_concur_associate_attendees',
  'sap_concur_create_list_item',
  'sap_concur_create_quick_expense',
  'sap_concur_create_quick_expense_with_image',
  'sap_concur_create_travel_request',
  'sap_concur_update_list_item',
  'sap_concur_update_travel_request',
  'sap_concur_move_travel_request',
  'sap_concur_create_expected_expense',
  'sap_concur_update_expected_expense',
  'sap_concur_create_cash_advance',
  'sap_concur_issue_cash_advance',
  'sap_concur_create_user',
  'sap_concur_update_user',
  'sap_concur_search_users',
  'sap_concur_create_purchase_request',
  'sap_concur_upload_exchange_rates',
]

/** Canonical receipt pair: basic upload, advanced file reference. */
const RECEIPT_FIELD = ['receiptFile', 'receiptFileRef'] as const

export const SapConcurBlock: BlockConfig<SapConcurProxyResponse> = {
  type: 'sap_concur',
  name: 'SAP Concur',
  description: 'Manage expense reports, travel requests, cash advances, and more in SAP Concur',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect SAP Concur with an OAuth client ID and secret (client-credentials or password grant) — no account linking required. Manage expense reports and line items, allocations, attendees, comments, exceptions, quick expenses, receipts, travel requests and expected expenses, cash advances, itineraries, user identities, custom lists, budgets, exchange rates, and purchase requests across every Concur datacenter.',
  docsLink: 'https://docs.sim.ai/integrations/sap_concur',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: SapConcurIcon,
  canvasPresentation: {
    defaultTitle: 'SAP Concur',
    sentences: {
      byOperation: {
        sap_concur_list_expense_reports: [
          'List expense reports',
          { text: ', for', field: 'expenseReportUser' },
          { text: ', with approval status', field: 'approvalStatusCode' },
        ],
        sap_concur_get_expense_report: [
          { text: 'Read expense report', field: 'reportId', core: true },
        ],
        sap_concur_create_expense_report: [
          { text: 'Create an expense report for user', field: 'userId', core: true },
          { text: ', with', field: 'body' },
        ],
        sap_concur_update_expense_report: [
          { text: 'Update expense report', field: 'reportId', core: true },
          { text: ', setting', field: 'body' },
        ],
        sap_concur_delete_expense_report: [
          { text: 'Delete expense report', field: 'reportId', core: true },
        ],
        sap_concur_submit_expense_report: [
          { text: 'Submit expense report', field: 'reportId', core: true },
          { text: 'for user', field: 'userId' },
        ],
        sap_concur_recall_expense_report: [
          { text: 'Recall submitted expense report', field: 'reportId', core: true },
        ],
        sap_concur_approve_expense_report: [
          { text: 'Approve expense report', field: 'reportId', core: true },
        ],
        sap_concur_send_back_expense_report: [
          {
            text: 'Return expense report',
            field: 'reportId',
            after: 'to the employee',
            core: true,
          },
        ],
        sap_concur_list_reports_to_approve: [
          'List expense reports awaiting approval',
          { text: ', sorted by', field: 'reportsToApproveSort' },
        ],
        sap_concur_list_expenses: [
          { text: 'List expenses on report', field: 'reportId', core: true },
        ],
        sap_concur_get_expense: [
          { text: 'Read expense', field: 'expenseId', core: true },
          { text: 'on report', field: 'reportId' },
        ],
        sap_concur_update_expense: [
          { text: 'Update expense', field: 'expenseId', core: true },
          { text: 'on report', field: 'reportId' },
          { text: ', setting', field: 'body' },
        ],
        sap_concur_delete_expense: [
          { text: 'Delete expense', field: 'expenseId', core: true },
          { text: 'from report', field: 'reportId' },
        ],
        sap_concur_get_itemizations: [
          { text: 'List itemizations of expense', field: 'expenseId', core: true },
          { text: 'on report', field: 'reportId' },
        ],
        sap_concur_list_allocations: [
          { text: 'List allocations on expense', field: 'expenseId', core: true },
          { text: 'of report', field: 'reportId' },
        ],
        sap_concur_get_allocation: [
          { text: 'Read allocation', field: 'allocationId', core: true },
          { text: 'on report', field: 'reportId' },
        ],
        sap_concur_update_allocation: [
          { text: 'Update allocation', field: 'allocationId', core: true },
          { text: 'on report', field: 'reportId' },
          { text: ', setting', field: 'body' },
        ],
        sap_concur_list_attendee_associations: [
          { text: 'List attendees on expense', field: 'expenseId', core: true },
          { text: 'of report', field: 'reportId' },
        ],
        sap_concur_associate_attendees: [
          { text: 'Attach attendees to expense', field: 'expenseId', core: true },
          { text: 'on report', field: 'reportId' },
        ],
        sap_concur_remove_all_attendees: [
          { text: 'Remove every attendee from expense', field: 'expenseId', core: true },
          { text: 'on report', field: 'reportId' },
        ],
        sap_concur_list_report_comments: [
          { text: 'List comments on report', field: 'reportId', core: true },
        ],
        sap_concur_create_report_comment: [
          { text: 'Comment', field: 'comment', core: true },
          { text: 'on report', field: 'reportId', core: true },
        ],
        sap_concur_list_exceptions: [
          { text: 'List policy exceptions on report', field: 'reportId', core: true },
        ],
        sap_concur_create_quick_expense: [
          { text: 'Create a quick expense for user', field: 'userId', core: true },
          { text: ', with', field: 'body' },
        ],
        sap_concur_create_quick_expense_with_image: [
          { text: 'Create a quick expense from receipt', field: RECEIPT_FIELD, core: true },
          { text: ', for user', field: 'userId' },
        ],
        sap_concur_list_receipts: [{ text: 'List receipts for user', field: 'userId', core: true }],
        sap_concur_get_receipt: [{ text: 'Read receipt', field: 'receiptId', core: true }],
        sap_concur_get_receipt_status: [
          { text: 'Read the processing status of receipt', field: 'receiptId', core: true },
        ],
        sap_concur_upload_receipt_image: [
          { text: 'Upload receipt image', field: RECEIPT_FIELD, core: true },
          { text: 'for user', field: 'userId' },
        ],
        sap_concur_list_travel_requests: [
          'List travel requests',
          { text: ', for user', field: 'travelRequestUserId' },
          { text: ', in the', field: 'view', after: 'view' },
        ],
        sap_concur_get_travel_request: [
          { text: 'Read travel request', field: 'requestUuid', core: true },
        ],
        sap_concur_create_travel_request: [
          'Create a travel request',
          { text: ', for user', field: 'travelRequestUserId' },
          { text: ', with', field: 'body' },
        ],
        sap_concur_update_travel_request: [
          { text: 'Update travel request', field: 'requestUuid', core: true },
          { text: ', setting', field: 'body' },
        ],
        sap_concur_delete_travel_request: [
          { text: 'Delete travel request', field: 'requestUuid', core: true },
        ],
        sap_concur_move_travel_request: [
          { text: 'Run workflow action', field: 'action', core: true },
          { text: 'on travel request', field: 'requestUuid', core: true },
        ],
        sap_concur_list_travel_request_comments: [
          { text: 'List comments on travel request', field: 'requestUuid', core: true },
        ],
        sap_concur_get_request_cash_advance: [
          { text: 'Read travel request cash advance', field: 'cashAdvanceUuid', core: true },
        ],
        sap_concur_create_expected_expense: [
          {
            text: 'Add an expected expense to travel request',
            field: 'requestUuid',
            core: true,
          },
          { text: ', with', field: 'body' },
        ],
        sap_concur_list_expected_expenses: [
          {
            text: 'List expected expenses on travel request',
            field: 'requestUuid',
            core: true,
          },
        ],
        sap_concur_get_expected_expense: [
          { text: 'Read expected expense', field: 'expenseUuid', core: true },
        ],
        sap_concur_update_expected_expense: [
          { text: 'Update expected expense', field: 'expenseUuid', core: true },
          { text: ', setting', field: 'body' },
        ],
        sap_concur_delete_expected_expense: [
          { text: 'Delete expected expense', field: 'expenseUuid', core: true },
        ],
        sap_concur_create_cash_advance: [
          'Create a cash advance',
          { text: ', with', field: 'body' },
        ],
        sap_concur_get_cash_advance: [
          { text: 'Read cash advance', field: 'cashAdvanceId', core: true },
        ],
        sap_concur_issue_cash_advance: [
          { text: 'Issue cash advance', field: 'cashAdvanceId', core: true },
        ],
        sap_concur_list_itineraries: [
          'List trips',
          { text: ', from', field: 'startDate' },
          { text: ', through', field: 'endDate' },
        ],
        sap_concur_get_itinerary: [{ text: 'Read trip', field: 'tripId', core: true }],
        sap_concur_list_users: [
          'List user identities',
          { text: ', returning', field: 'attributes' },
        ],
        sap_concur_get_user: [{ text: 'Read user', field: 'userUuid', core: true }],
        sap_concur_create_user: ['Create a user identity', { text: ', with', field: 'body' }],
        sap_concur_update_user: [
          { text: 'Update user', field: 'userUuid', core: true },
          { text: ', setting', field: 'body' },
        ],
        sap_concur_delete_user: [{ text: 'Delete user', field: 'userUuid', core: true }],
        sap_concur_search_users: ['Search users', { text: ', matching', field: 'body' }],
        sap_concur_list_lists: ['List custom lists', { text: ', sorted by', field: 'sortBy' }],
        sap_concur_get_list: [{ text: 'Read custom list', field: 'listId', core: true }],
        sap_concur_list_list_items: [
          { text: 'List items in custom list', field: 'listId', core: true },
          { text: ', sorted by', field: 'sortBy' },
        ],
        sap_concur_get_list_item: [{ text: 'Read list item', field: 'itemId', core: true }],
        sap_concur_create_list_item: ['Create a list item', { text: ', with', field: 'body' }],
        sap_concur_update_list_item: [
          { text: 'Update list item', field: 'itemId', core: true },
          { text: ', setting', field: 'body' },
        ],
        sap_concur_delete_list_item: [{ text: 'Delete list item', field: 'itemId', core: true }],
        sap_concur_list_budgets: [
          'List budget item headers',
          { text: ', starting at', field: 'offset' },
        ],
        sap_concur_get_budget: [{ text: 'Read budget item header', field: 'budgetId', core: true }],
        sap_concur_list_budget_categories: ['List budget categories'],
        sap_concur_upload_exchange_rates: [
          'Upload custom exchange rates',
          { text: ', from', field: 'body' },
        ],
        sap_concur_create_purchase_request: [
          'Create a purchase request',
          { text: ', with', field: 'body' },
        ],
        sap_concur_get_purchase_request: [
          { text: 'Read purchase request', field: 'purchaseRequestId', core: true },
        ],
        sap_concur_get_travel_profile: [
          'Read a travel profile',
          { text: ', for user', field: 'useridValue' },
        ],
        sap_concur_list_travel_profiles_summary: [
          'List travel profile summaries',
          { text: ', modified since', field: 'lastModifiedDate' },
        ],
        sap_concur_search_locations: [
          'Search locations',
          { text: ', matching', field: 'searchText' },
          { text: ', in country', field: 'countryCode' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Expense Reports', id: 'sap_concur_list_expense_reports' },
        { label: 'Get Expense Report', id: 'sap_concur_get_expense_report' },
        { label: 'Create Expense Report', id: 'sap_concur_create_expense_report' },
        { label: 'Update Expense Report', id: 'sap_concur_update_expense_report' },
        { label: 'Delete Expense Report', id: 'sap_concur_delete_expense_report' },
        { label: 'Submit Expense Report', id: 'sap_concur_submit_expense_report' },
        { label: 'Recall Expense Report', id: 'sap_concur_recall_expense_report' },
        { label: 'Approve Expense Report', id: 'sap_concur_approve_expense_report' },
        { label: 'Send Back Expense Report', id: 'sap_concur_send_back_expense_report' },
        { label: 'List Reports To Approve', id: 'sap_concur_list_reports_to_approve' },
        { label: 'List Expenses', id: 'sap_concur_list_expenses' },
        { label: 'Get Expense', id: 'sap_concur_get_expense' },
        { label: 'Update Expense', id: 'sap_concur_update_expense' },
        { label: 'Delete Expense', id: 'sap_concur_delete_expense' },
        { label: 'Get Itemizations', id: 'sap_concur_get_itemizations' },
        { label: 'List Allocations', id: 'sap_concur_list_allocations' },
        { label: 'Get Allocation', id: 'sap_concur_get_allocation' },
        { label: 'Update Allocation', id: 'sap_concur_update_allocation' },
        { label: 'List Attendee Associations', id: 'sap_concur_list_attendee_associations' },
        { label: 'Associate Attendees', id: 'sap_concur_associate_attendees' },
        { label: 'Remove All Attendees', id: 'sap_concur_remove_all_attendees' },
        { label: 'List Report Comments', id: 'sap_concur_list_report_comments' },
        { label: 'Create Report Comment', id: 'sap_concur_create_report_comment' },
        { label: 'List Exceptions', id: 'sap_concur_list_exceptions' },
        { label: 'Create Quick Expense', id: 'sap_concur_create_quick_expense' },
        {
          label: 'Create Quick Expense (With Image)',
          id: 'sap_concur_create_quick_expense_with_image',
        },
        { label: 'List Receipts', id: 'sap_concur_list_receipts' },
        { label: 'Get Receipt', id: 'sap_concur_get_receipt' },
        { label: 'Get Receipt Status', id: 'sap_concur_get_receipt_status' },
        { label: 'Upload Receipt Image', id: 'sap_concur_upload_receipt_image' },
        { label: 'List Travel Requests', id: 'sap_concur_list_travel_requests' },
        { label: 'Get Travel Request', id: 'sap_concur_get_travel_request' },
        { label: 'Create Travel Request', id: 'sap_concur_create_travel_request' },
        { label: 'Update Travel Request', id: 'sap_concur_update_travel_request' },
        { label: 'Delete Travel Request', id: 'sap_concur_delete_travel_request' },
        { label: 'Move Travel Request (Workflow Action)', id: 'sap_concur_move_travel_request' },
        {
          label: 'List Travel Request Comments',
          id: 'sap_concur_list_travel_request_comments',
        },
        {
          label: 'Get Request Cash Advance',
          id: 'sap_concur_get_request_cash_advance',
        },
        { label: 'Create Expected Expense', id: 'sap_concur_create_expected_expense' },
        { label: 'List Expected Expenses', id: 'sap_concur_list_expected_expenses' },
        { label: 'Get Expected Expense', id: 'sap_concur_get_expected_expense' },
        { label: 'Update Expected Expense', id: 'sap_concur_update_expected_expense' },
        { label: 'Delete Expected Expense', id: 'sap_concur_delete_expected_expense' },
        { label: 'Create Cash Advance', id: 'sap_concur_create_cash_advance' },
        { label: 'Get Cash Advance', id: 'sap_concur_get_cash_advance' },
        { label: 'Issue Cash Advance', id: 'sap_concur_issue_cash_advance' },
        { label: 'List Itineraries (Trips)', id: 'sap_concur_list_itineraries' },
        { label: 'Get Itinerary (Trip)', id: 'sap_concur_get_itinerary' },
        { label: 'List Users', id: 'sap_concur_list_users' },
        { label: 'Get User', id: 'sap_concur_get_user' },
        { label: 'Create User', id: 'sap_concur_create_user' },
        { label: 'Update User (PATCH)', id: 'sap_concur_update_user' },
        { label: 'Delete User', id: 'sap_concur_delete_user' },
        { label: 'Search Users', id: 'sap_concur_search_users' },
        { label: 'List Lists', id: 'sap_concur_list_lists' },
        { label: 'Get List', id: 'sap_concur_get_list' },
        { label: 'List List Items', id: 'sap_concur_list_list_items' },
        { label: 'Get List Item', id: 'sap_concur_get_list_item' },
        { label: 'Create List Item', id: 'sap_concur_create_list_item' },
        { label: 'Update List Item', id: 'sap_concur_update_list_item' },
        { label: 'Delete List Item', id: 'sap_concur_delete_list_item' },
        { label: 'List Budgets', id: 'sap_concur_list_budgets' },
        { label: 'Get Budget', id: 'sap_concur_get_budget' },
        { label: 'List Budget Categories', id: 'sap_concur_list_budget_categories' },
        { label: 'Upload Exchange Rates', id: 'sap_concur_upload_exchange_rates' },
        { label: 'Create Purchase Request', id: 'sap_concur_create_purchase_request' },
        { label: 'Get Purchase Request', id: 'sap_concur_get_purchase_request' },
        { label: 'Get Travel Profile', id: 'sap_concur_get_travel_profile' },
        {
          label: 'List Travel Profiles Summary',
          id: 'sap_concur_list_travel_profiles_summary',
        },
        { label: 'Search Locations', id: 'sap_concur_search_locations' },
      ],
      value: () => 'sap_concur_list_expense_reports',
      required: true,
    },

    // Auth fields
    {
      id: 'datacenter',
      title: 'Datacenter',
      type: 'dropdown',
      options: [
        {
          label: 'US — may request client cert (us.api.concursolutions.com)',
          id: 'us.api.concursolutions.com',
        },
        {
          label: 'US — no client cert (www-us.api.concursolutions.com)',
          id: 'www-us.api.concursolutions.com',
        },
        {
          label: 'US 2 — may request client cert (us2.api.concursolutions.com)',
          id: 'us2.api.concursolutions.com',
        },
        {
          label: 'US 2 — no client cert (www-us2.api.concursolutions.com)',
          id: 'www-us2.api.concursolutions.com',
        },
        {
          label: 'EU — may request client cert (eu.api.concursolutions.com)',
          id: 'eu.api.concursolutions.com',
        },
        {
          label: 'EU 2 — may request client cert (eu2.api.concursolutions.com)',
          id: 'eu2.api.concursolutions.com',
        },
        {
          label: 'EU 2 — no client cert (www-eu2.api.concursolutions.com)',
          id: 'www-eu2.api.concursolutions.com',
        },
        {
          label: 'EMEA — may request client cert (emea.api.concursolutions.com)',
          id: 'emea.api.concursolutions.com',
        },
        {
          label: 'EMEA — no client cert (www-emea.api.concursolutions.com)',
          id: 'www-emea.api.concursolutions.com',
        },
        {
          label: 'APJ — may request client cert (apj1.api.concursolutions.com)',
          id: 'apj1.api.concursolutions.com',
        },
        {
          label: 'APJ — no client cert (www-apj1.api.concursolutions.com)',
          id: 'www-apj1.api.concursolutions.com',
        },
        {
          label: 'US Gov — may request client cert (usg.api.concursolutions.com)',
          id: 'usg.api.concursolutions.com',
        },
        {
          label: 'US Gov — no client cert (www-usg.api.concursolutions.com)',
          id: 'www-usg.api.concursolutions.com',
        },
        {
          label: 'GLZ — may request client cert (glz.api.concursolutions.com)',
          id: 'glz.api.concursolutions.com',
        },
        {
          label: 'US Implementation — may request client cert (us-impl.api.concursolutions.com)',
          id: 'us-impl.api.concursolutions.com',
        },
        {
          label: 'US Implementation — no client cert (www-us-impl.api.concursolutions.com)',
          id: 'www-us-impl.api.concursolutions.com',
        },
        {
          label:
            'EMEA Implementation — may request client cert (emea-impl.api.concursolutions.com)',
          id: 'emea-impl.api.concursolutions.com',
        },
        {
          label: 'EMEA Implementation — no client cert (www-emea-impl.api.concursolutions.com)',
          id: 'www-emea-impl.api.concursolutions.com',
        },
      ],
      value: () => 'us.api.concursolutions.com',
      required: true,
    },
    {
      id: 'grantType',
      title: 'OAuth Grant Type',
      type: 'dropdown',
      options: [
        { label: 'Client Credentials', id: 'client_credentials' },
        { label: 'Password', id: 'password' },
      ],
      value: () => 'client_credentials',
    },
    {
      id: 'clientId',
      title: 'OAuth Client ID',
      type: 'short-input',
      placeholder: 'Concur OAuth client ID',
      password: true,
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'OAuth Client Secret',
      type: 'short-input',
      placeholder: 'Concur OAuth client secret',
      password: true,
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'User login — or leave blank and set Company UUID',
      condition: { field: 'grantType', value: 'password' },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'User password, or the 24-hour company request token',
      password: true,
      condition: { field: 'grantType', value: 'password' },
      required: { field: 'grantType', value: 'password' },
    },
    {
      id: 'companyUuid',
      title: 'Company UUID',
      type: 'short-input',
      placeholder: 'Company-level auth: sent as the token username',
      mode: 'advanced',
    },

    // Shared user/context fields for expense report ops
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Concur user UUID',
      condition: { field: 'operation', value: REPORT_USER_OPS },
      required: { field: 'operation', value: REPORT_USER_OPS },
    },
    {
      id: 'contextType',
      title: 'Context Type',
      type: 'dropdown',
      options: [
        { label: 'TRAVELER', id: 'TRAVELER' },
        { label: 'MANAGER', id: 'MANAGER' },
        { label: 'PROCESSOR', id: 'PROCESSOR' },
        { label: 'PROXY', id: 'PROXY' },
      ],
      value: () => 'TRAVELER',
      condition: { field: 'operation', value: REPORT_GET_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: REPORT_GET_CONTEXT_TYPE_OPS },
    },
    {
      id: 'contextType',
      title: 'Context Type',
      type: 'dropdown',
      options: [
        { label: 'TRAVELER', id: 'TRAVELER' },
        { label: 'MANAGER', id: 'MANAGER' },
        { label: 'PROXY', id: 'PROXY' },
      ],
      value: () => 'TRAVELER',
      condition: { field: 'operation', value: EXPENSE_READ_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: EXPENSE_READ_CONTEXT_TYPE_OPS },
    },
    {
      id: 'contextType',
      title: 'Context Type',
      type: 'dropdown',
      options: [{ label: 'TRAVELER', id: 'TRAVELER' }],
      value: () => 'TRAVELER',
      condition: { field: 'operation', value: TRAVELER_ONLY_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: TRAVELER_ONLY_CONTEXT_TYPE_OPS },
    },
    {
      id: 'contextType',
      title: 'Context Type',
      type: 'dropdown',
      options: [
        { label: 'TRAVELER', id: 'TRAVELER' },
        { label: 'MANAGER', id: 'MANAGER' },
      ],
      value: () => 'TRAVELER',
      condition: { field: 'operation', value: LIST_ALLOCATIONS_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: LIST_ALLOCATIONS_CONTEXT_TYPE_OPS },
    },
    {
      id: 'contextType',
      title: 'Context Type',
      type: 'dropdown',
      options: [
        { label: 'TRAVELER', id: 'TRAVELER' },
        { label: 'PROXY', id: 'PROXY' },
      ],
      value: () => 'TRAVELER',
      condition: { field: 'operation', value: ALLOCATION_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: ALLOCATION_CONTEXT_TYPE_OPS },
    },
    {
      id: 'contextType',
      title: 'Context Type',
      type: 'dropdown',
      options: [
        { label: 'TRAVELER', id: 'TRAVELER' },
        { label: 'PROXY', id: 'PROXY' },
      ],
      value: () => 'TRAVELER',
      condition: { field: 'operation', value: ATTENDEE_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: ATTENDEE_CONTEXT_TYPE_OPS },
    },

    // Report ID
    {
      id: 'reportId',
      title: 'Report ID',
      type: 'short-input',
      placeholder: 'Report ID',
      condition: { field: 'operation', value: REPORT_ID_OPS },
      required: { field: 'operation', value: REPORT_ID_OPS },
    },
    {
      id: 'expenseId',
      title: 'Expense ID',
      type: 'short-input',
      placeholder: 'Expense entry ID',
      condition: { field: 'operation', value: EXPENSE_ID_OPS },
      required: { field: 'operation', value: EXPENSE_ID_OPS },
    },
    {
      id: 'allocationId',
      title: 'Allocation ID',
      type: 'short-input',
      placeholder: 'Allocation ID',
      condition: {
        field: 'operation',
        value: ['sap_concur_get_allocation', 'sap_concur_update_allocation'],
      },
      required: {
        field: 'operation',
        value: ['sap_concur_get_allocation', 'sap_concur_update_allocation'],
      },
    },
    {
      id: 'expenseReportUser',
      title: 'User',
      type: 'short-input',
      placeholder: 'Login ID or user identifier',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'approvalStatusCode',
      title: 'Approval Status Code',
      type: 'short-input',
      placeholder: 'A_NOTF, A_PEND, A_APPR...',
      wandConfig: {
        enabled: true,
        prompt: `Generate a SAP Concur v3 expense report approval status code from the user's request.

Valid codes include A_NOTF (not submitted), A_PEND (pending approval), A_APPR (approved), A_ACCO (pending cost object approval), A_RESU (submitted, pending validation), A_TEXP (approved, pending expense processor review), A_RJCT (sent back to employee), A_PECO (pending expense processor review).

Return ONLY the approval status code - no explanations, no extra text.`,
        placeholder: 'Describe the approval state (e.g., "reports still awaiting approval")',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'paymentStatusCode',
      title: 'Payment Status Code',
      type: 'short-input',
      placeholder: 'P_NOTP, P_PAID...',
      wandConfig: {
        enabled: true,
        prompt: `Generate a SAP Concur v3 expense report payment status code from the user's request.

Valid codes include P_NOTP (not paid), P_PROC (processing payment), P_PAYC (payment confirmed), P_PAID (paid).

Return ONLY the payment status code - no explanations, no extra text.`,
        placeholder: 'Describe the payment state (e.g., "reports that have not been reimbursed")',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'currencyCode',
      title: 'Currency Code',
      type: 'short-input',
      placeholder: 'USD, EUR...',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'approverLoginID',
      title: 'Approver Login ID',
      type: 'short-input',
      placeholder: 'approver@example.com',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'submitDateAfter',
      title: 'Submit Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'submitDateBefore',
      title: 'Submit Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'paidDateAfter',
      title: 'Paid Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'paidDateBefore',
      title: 'Paid Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'modifiedDateAfter',
      title: 'Modified Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'modifiedDateBefore',
      title: 'Modified Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'createDateAfter',
      title: 'Create Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'createDateBefore',
      title: 'Create Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into a SAP Concur v3 expense report date filter.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the first of last month" -> the first day of the previous month, "30 days ago" -> the date 30 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "the first of last month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Comment text',
      condition: { field: 'operation', value: 'sap_concur_create_report_comment' },
      required: { field: 'operation', value: 'sap_concur_create_report_comment' },
    },
    {
      id: 'sendbackComment',
      title: 'Sendback Comment',
      type: 'long-input',
      placeholder: 'Visible wherever Request comments are shown',
      condition: {
        field: 'operation',
        value: 'sap_concur_move_travel_request',
        and: { field: 'action', value: 'sendback' },
      },
      mode: 'advanced',
    },
    {
      id: 'includeAllComments',
      title: 'Include All Comments',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_report_comments' },
      mode: 'advanced',
    },
    {
      id: 'excludeExpenses',
      title: 'Exclude Expense Exceptions',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_exceptions' },
      mode: 'advanced',
    },

    // Receipt
    {
      id: 'receiptId',
      title: 'Receipt ID',
      type: 'short-input',
      placeholder: 'Receipt ID',
      condition: {
        field: 'operation',
        value: ['sap_concur_get_receipt', 'sap_concur_get_receipt_status'],
      },
      required: {
        field: 'operation',
        value: ['sap_concur_get_receipt', 'sap_concur_get_receipt_status'],
      },
    },

    // Travel Requests
    {
      id: 'requestUuid',
      title: 'Travel Request UUID',
      type: 'short-input',
      placeholder: 'Travel request UUID',
      condition: { field: 'operation', value: REQUEST_UUID_OPS },
      required: { field: 'operation', value: REQUEST_UUID_OPS },
    },
    {
      id: 'view',
      title: 'View',
      type: 'short-input',
      placeholder: 'ALL, ACTIVE, PENDING, TOAPPROVE',
      condition: { field: 'operation', value: 'sap_concur_list_travel_requests' },
    },
    {
      id: 'travelRequestApprovedBefore',
      title: 'Approved Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_travel_requests' },
      mode: 'advanced',
    },
    {
      id: 'travelRequestApprovedAfter',
      title: 'Approved After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_travel_requests' },
      mode: 'advanced',
    },
    {
      id: 'travelRequestModifiedBefore',
      title: 'Modified Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_travel_requests' },
      mode: 'advanced',
    },
    {
      id: 'travelRequestModifiedAfter',
      title: 'Modified After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_travel_requests' },
      mode: 'advanced',
    },
    {
      id: 'travelRequestSortField',
      title: 'Sort Field',
      type: 'short-input',
      placeholder: 'startDate',
      condition: { field: 'operation', value: 'sap_concur_list_travel_requests' },
      mode: 'advanced',
    },
    {
      id: 'travelRequestSortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      condition: { field: 'operation', value: 'sap_concur_list_travel_requests' },
      mode: 'advanced',
    },
    {
      id: 'travelRequestUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Concur user UUID (optional impersonation)',
      condition: {
        field: 'operation',
        value: [
          'sap_concur_list_travel_requests',
          'sap_concur_get_travel_request',
          'sap_concur_create_travel_request',
          'sap_concur_update_travel_request',
          'sap_concur_delete_travel_request',
          'sap_concur_move_travel_request',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'companyID',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Company identifier for the workflow action',
      condition: { field: 'operation', value: 'sap_concur_move_travel_request' },
      mode: 'advanced',
    },
    {
      id: 'action',
      title: 'Workflow Action',
      type: 'dropdown',
      options: [
        { label: 'Submit', id: 'submit' },
        { label: 'Recall', id: 'recall' },
        { label: 'Cancel', id: 'cancel' },
        { label: 'Approve', id: 'approve' },
        { label: 'Send Back', id: 'sendback' },
        { label: 'Close', id: 'close' },
        { label: 'Reopen', id: 'reopen' },
      ],
      value: () => 'submit',
      condition: { field: 'operation', value: 'sap_concur_move_travel_request' },
      required: { field: 'operation', value: 'sap_concur_move_travel_request' },
    },

    // Expected Expenses
    {
      id: 'expectedExpenseUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Concur user UUID (optional impersonation)',
      condition: {
        field: 'operation',
        value: [
          'sap_concur_list_expected_expenses',
          'sap_concur_create_expected_expense',
          'sap_concur_get_expected_expense',
          'sap_concur_update_expected_expense',
          'sap_concur_delete_expected_expense',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'expenseUuid',
      title: 'Expected Expense UUID',
      type: 'short-input',
      placeholder: 'Expected expense UUID',
      condition: {
        field: 'operation',
        value: [
          'sap_concur_get_expected_expense',
          'sap_concur_update_expected_expense',
          'sap_concur_delete_expected_expense',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'sap_concur_get_expected_expense',
          'sap_concur_update_expected_expense',
          'sap_concur_delete_expected_expense',
        ],
      },
    },

    // Cash advances
    {
      id: 'cashAdvanceUuid',
      title: 'Cash Advance UUID',
      type: 'short-input',
      placeholder: 'Cash advance UUID',
      condition: { field: 'operation', value: 'sap_concur_get_request_cash_advance' },
      required: { field: 'operation', value: 'sap_concur_get_request_cash_advance' },
    },
    {
      id: 'cashAdvanceId',
      title: 'Cash Advance ID',
      type: 'short-input',
      placeholder: 'Cash advance ID',
      condition: {
        field: 'operation',
        value: ['sap_concur_get_cash_advance', 'sap_concur_issue_cash_advance'],
      },
      required: {
        field: 'operation',
        value: ['sap_concur_get_cash_advance', 'sap_concur_issue_cash_advance'],
      },
    },

    // Itineraries
    {
      id: 'tripId',
      title: 'Trip ID',
      type: 'short-input',
      placeholder: 'Trip ID',
      condition: { field: 'operation', value: 'sap_concur_get_itinerary' },
      required: { field: 'operation', value: 'sap_concur_get_itinerary' },
    },
    {
      id: 'useridType',
      title: 'User ID Type',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'login', id: 'login' },
        { label: 'xmlsyncid', id: 'xmlsyncid' },
        { label: 'uuid', id: 'uuid' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'sap_concur_get_itinerary',
          'sap_concur_list_itineraries',
          'sap_concur_get_travel_profile',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'useridValue',
      title: 'User ID Value',
      type: 'short-input',
      placeholder: 'User identifier value',
      condition: {
        field: 'operation',
        value: [
          'sap_concur_get_itinerary',
          'sap_concur_list_itineraries',
          'sap_concur_get_travel_profile',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'systemFormat',
      title: 'System Format',
      type: 'short-input',
      placeholder: 'Tripit',
      condition: { field: 'operation', value: 'sap_concur_get_itinerary' },
      mode: 'advanced',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into the earliest trip start date for a SAP Concur itinerary search.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "the start of this quarter" -> the first day of the current quarter, "two weeks ago" -> the date 14 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the earliest trip date (e.g., "the start of this quarter")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into the latest trip end date for a SAP Concur itinerary search.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "end of next month" -> the last day of the following month, "today" -> today's date.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the latest trip date (e.g., "end of next month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'bookingType',
      title: 'Booking Type',
      type: 'short-input',
      placeholder: 'air, car, hotel, rail',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'itineraryItemsPerPage',
      title: 'Items Per Page',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'itineraryPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'includeMetadata',
      title: 'Include Metadata',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'includeCanceledTrips',
      title: 'Include Canceled Trips',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'includeVirtualTrip',
      title: 'Include Virtual Trips',
      type: 'short-input',
      placeholder: '1 to include Request-booked offline segments',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'includeGuestBookings',
      title: 'Include Guest Bookings',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'createdAfterDate',
      title: 'Created After Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into the earliest trip creation date for a SAP Concur itinerary search.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "booked since last Monday" -> the date of the most recent Monday.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe when the trip was booked (e.g., "since last Monday")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'createdBeforeDate',
      title: 'Created Before Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into the latest trip creation date for a SAP Concur itinerary search.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "booked before this month" -> the last day of the previous month.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the booking cutoff (e.g., "before this month")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'itineraryLastModifiedDate',
      title: 'Last Modified Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a date into the last-modified cutoff for a SAP Concur itinerary search.

The output must be a calendar date in YYYY-MM-DD form, resolved against the current date. For example "changed in the last week" -> the date 7 days before today.

If the input looks like a reference to another block's output (contains < and >) or is already YYYY-MM-DD, return it as-is.
Return ONLY the YYYY-MM-DD date - no explanations, no extra text.`,
        placeholder: 'Describe the change cutoff (e.g., "changed in the last week")',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },

    // Users
    {
      id: 'userUuid',
      title: 'User UUID',
      type: 'short-input',
      placeholder: 'User UUID',
      condition: {
        field: 'operation',
        value: ['sap_concur_get_user', 'sap_concur_update_user', 'sap_concur_delete_user'],
      },
      required: {
        field: 'operation',
        value: ['sap_concur_get_user', 'sap_concur_update_user', 'sap_concur_delete_user'],
      },
    },
    {
      id: 'count',
      title: 'Count',
      canvasNoun: 'how many',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'sap_concur_list_users' },
      mode: 'advanced',
    },
    {
      id: 'usersCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: { field: 'operation', value: 'sap_concur_list_users' },
      mode: 'advanced',
    },
    {
      id: 'attributes',
      title: 'Attributes',
      type: 'short-input',
      placeholder: 'id,active,emails',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of SCIM user attribute names to return from SAP Concur Identity v4.

Use SCIM attribute paths such as id, externalId, userName, active, displayName, name.givenName, name.familyName, emails, emails.value, title, userType, and enterprise extension paths like urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber.

Return ONLY the comma-separated attribute names - no explanations, no extra text.`,
        placeholder: 'Describe the user fields to return (e.g., "just email and status")',
      },
      condition: {
        field: 'operation',
        value: ['sap_concur_list_users', 'sap_concur_get_user'],
      },
    },
    {
      id: 'excludedAttributes',
      title: 'Excluded Attributes',
      type: 'short-input',
      placeholder: 'name,emails',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of SCIM user attribute names to omit from a SAP Concur Identity v4 response.

Use SCIM attribute paths such as name, emails, phoneNumbers, addresses, entitlements, and enterprise extension paths like urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager.

Return ONLY the comma-separated attribute names - no explanations, no extra text.`,
        placeholder: 'Describe the user fields to drop (e.g., "leave out addresses and phones")',
      },
      condition: {
        field: 'operation',
        value: ['sap_concur_list_users', 'sap_concur_get_user'],
      },
      mode: 'advanced',
    },

    // Lists
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'List ID',
      condition: {
        field: 'operation',
        value: ['sap_concur_get_list', 'sap_concur_list_list_items'],
      },
      required: {
        field: 'operation',
        value: ['sap_concur_get_list', 'sap_concur_list_list_items'],
      },
    },
    // Budgets
    {
      id: 'budgetId',
      title: 'Budget Item Header ID',
      type: 'short-input',
      placeholder: 'Budget header syncguid',
      condition: { field: 'operation', value: 'sap_concur_get_budget' },
      required: { field: 'operation', value: 'sap_concur_get_budget' },
    },
    {
      id: 'adminView',
      title: 'Admin View',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_budgets' },
      mode: 'advanced',
    },
    {
      id: 'responseSchema',
      title: 'Response Schema',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Compact', id: 'COMPACT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sap_concur_list_budgets' },
      mode: 'advanced',
    },

    // Purchase Requests
    {
      id: 'purchaseRequestId',
      title: 'Purchase Request ID',
      type: 'short-input',
      placeholder: 'Purchase request ID',
      condition: { field: 'operation', value: 'sap_concur_get_purchase_request' },
      required: { field: 'operation', value: 'sap_concur_get_purchase_request' },
    },

    // Pagination (shared across many list ops)
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: ['sap_concur_list_expense_reports', 'sap_concur_list_travel_requests'],
      },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: ['sap_concur_list_budgets', 'sap_concur_list_expense_reports'],
      },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: ['sap_concur_list_lists', 'sap_concur_list_list_items'],
      },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Name', id: 'name' },
        { label: 'Level Count', id: 'levelcount' },
        { label: 'List Category', id: 'listcategory' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sap_concur_list_lists' },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Value', id: 'value' },
        { label: 'Short Code', id: 'shortCode' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sap_concur_list_list_items' },
      mode: 'advanced',
    },
    {
      id: 'sortDirection',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      condition: {
        field: 'operation',
        value: ['sap_concur_list_lists', 'sap_concur_list_list_items'],
      },
      mode: 'advanced',
    },
    {
      id: 'reportsToApproveSort',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'reportDate',
      condition: { field: 'operation', value: 'sap_concur_list_reports_to_approve' },
      mode: 'advanced',
    },
    {
      id: 'reportsToApproveOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      condition: { field: 'operation', value: 'sap_concur_list_reports_to_approve' },
      mode: 'advanced',
    },
    {
      id: 'includeDelegateApprovals',
      title: 'Include Delegate Approvals',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_reports_to_approve' },
      mode: 'advanced',
    },
    {
      id: 'start',
      title: 'Start',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: ['sap_concur_list_travel_requests'],
      },
      mode: 'advanced',
    },

    // Custom list / list item filters (v4)
    {
      id: 'value',
      title: 'Value',
      type: 'short-input',
      placeholder: 'Exact value, or an operator form like sw:Trav, ew:ing, not:Old, cp:cost',
      condition: {
        field: 'operation',
        value: ['sap_concur_list_lists', 'sap_concur_list_list_items'],
      },
      mode: 'advanced',
    },
    {
      id: 'categoryType',
      title: 'Category Type',
      type: 'short-input',
      placeholder: 'List category type (e.g., EXPENSE)',
      condition: { field: 'operation', value: 'sap_concur_list_lists' },
      mode: 'advanced',
    },
    {
      id: 'levelCount',
      title: 'Level Count',
      type: 'short-input',
      placeholder: 'Exact count, or an operator form like eq:2, gt:1, gte:2, lt:4, lte:3',
      condition: { field: 'operation', value: 'sap_concur_list_lists' },
      mode: 'advanced',
    },
    {
      id: 'isDeleted',
      title: 'Is Deleted',
      type: 'short-input',
      placeholder: 'true, false, or the operator form eq:true',
      condition: {
        field: 'operation',
        value: ['sap_concur_list_lists', 'sap_concur_list_list_items'],
      },
      mode: 'advanced',
    },
    {
      id: 'shortCode',
      title: 'Short Code',
      type: 'short-input',
      placeholder: 'Exact short code, or an operator form like sw:EU',
      condition: { field: 'operation', value: 'sap_concur_list_list_items' },
      mode: 'advanced',
    },
    {
      id: 'shortCodeOrValue',
      title: 'Short Code Or Value',
      type: 'short-input',
      placeholder: 'Matches either field, or an operator form like cp:travel',
      condition: { field: 'operation', value: 'sap_concur_list_list_items' },
      mode: 'advanced',
    },
    {
      id: 'hasChildren',
      title: 'Has Children',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_list_items' },
      mode: 'advanced',
    },

    // List Item ID (for update/delete list item)
    {
      id: 'itemId',
      title: 'List Item ID',
      type: 'short-input',
      placeholder: 'List item UUID',
      condition: { field: 'operation', value: LIST_ITEM_ID_OPS },
      required: { field: 'operation', value: LIST_ITEM_ID_OPS },
    },

    // Travel Profile fields
    {
      id: 'lastModifiedDate',
      title: 'Last Modified Date',
      type: 'short-input',
      placeholder: '1900-01-01T00:00:00 (UTC datetime)',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a moment in time into a SAP Concur Travel Profile summary cutoff.

The output must be a UTC datetime with no timezone suffix, in YYYY-MM-DDTHH:mm:ss form, resolved against the current date. For example "everything" -> 1900-01-01T00:00:00, "changed in the last day" -> the datetime 24 hours before now.

If the input looks like a reference to another block's output (contains < and >) or is already in YYYY-MM-DDTHH:mm:ss form, return it as-is.
Return ONLY the UTC datetime - no explanations, no extra text.`,
        placeholder: 'Describe the cutoff (e.g., "profiles changed in the last day")',
        generationType: 'timestamp',
      },
      condition: {
        field: 'operation',
        value: 'sap_concur_list_travel_profiles_summary',
      },
      required: {
        field: 'operation',
        value: 'sap_concur_list_travel_profiles_summary',
      },
    },
    {
      id: 'travelProfilePage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'sap_concur_list_travel_profiles_summary' },
      mode: 'advanced',
    },
    {
      id: 'itemsPerPage',
      title: 'Items Per Page',
      type: 'short-input',
      placeholder: '200',
      condition: { field: 'operation', value: 'sap_concur_list_travel_profiles_summary' },
      mode: 'advanced',
    },
    {
      id: 'travelConfigs',
      title: 'Travel Config IDs',
      type: 'short-input',
      placeholder: 'Comma-separated config ids',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of SAP Concur travel configuration IDs from the user's request.

Travel configuration IDs are numeric identifiers issued by Concur. Emit them separated by commas with no spaces.

If the input looks like a reference to another block's output (contains < and >), return it as-is.
Return ONLY the comma-separated travel config IDs - no explanations, no extra text.`,
        placeholder: 'Describe or paste the travel configurations to scope the search to',
      },
      condition: { field: 'operation', value: 'sap_concur_list_travel_profiles_summary' },
      mode: 'advanced',
    },
    {
      id: 'active',
      title: 'User State',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active users', id: '1' },
        { label: 'Inactive users', id: '0' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sap_concur_list_travel_profiles_summary' },
      mode: 'advanced',
    },

    // Locations fields (v5)
    {
      id: 'searchText',
      title: 'Search Text',
      type: 'short-input',
      placeholder: 'Free-text search (city, landmark, etc.)',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
    },
    {
      id: 'locCode',
      title: 'Location Code',
      type: 'short-input',
      placeholder: 'IATA / city code (e.g., SEA)',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
      mode: 'advanced',
    },
    {
      id: 'locationNameId',
      title: 'Location Name ID',
      type: 'short-input',
      placeholder: 'Concur location name id',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
      mode: 'advanced',
    },
    {
      id: 'locationNameKey',
      title: 'Location Name Key',
      type: 'short-input',
      placeholder: 'Concur location name key',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
      mode: 'advanced',
    },
    {
      id: 'countryCode',
      title: 'Country Code (ISO 3166-1)',
      type: 'short-input',
      placeholder: 'US',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
      mode: 'advanced',
    },
    {
      id: 'subdivisionCode',
      title: 'Subdivision Code (ISO 3166-2)',
      type: 'short-input',
      placeholder: 'US-WA',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
      mode: 'advanced',
    },
    {
      id: 'adminRegionId',
      title: 'Administrative Region ID',
      type: 'short-input',
      placeholder: 'Concur admin region id',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
      mode: 'advanced',
    },

    // Receipt Image (basic mode — file picker)
    {
      id: 'receiptFile',
      title: 'Receipt Image',
      type: 'file-upload',
      canonicalParamId: 'receipt',
      placeholder: 'Upload receipt image',
      condition: { field: 'operation', value: RECEIPT_UPLOAD_OPS },
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: RECEIPT_UPLOAD_OPS },
      acceptedTypes: 'image/jpeg,image/png,image/gif,image/tiff,application/pdf',
    },
    // Receipt Image (advanced mode — variable reference)
    {
      id: 'receiptFileRef',
      title: 'Receipt Image',
      type: 'short-input',
      canonicalParamId: 'receipt',
      placeholder: 'Reference file from previous block',
      condition: { field: 'operation', value: RECEIPT_UPLOAD_OPS },
      mode: 'advanced',
      required: { field: 'operation', value: RECEIPT_UPLOAD_OPS },
    },
    // Body (JSON payload) — shared across all create/update/action ops
    {
      id: 'body',
      title: 'Request Body (JSON)',
      type: 'long-input',
      placeholder: '{ ... }',
      wandConfig: {
        enabled: true,
        prompt: `Generate the JSON request body for the selected SAP Concur operation from the user's request.

Match the payload to the resource being written. Every family below is camelCase EXCEPT exchange rates, which is snake_case.

Expense reports (v4): name, businessPurpose, comment, policyId, countryCode, countrySubDivisionCode, reportDate, startDate, endDate, and reportSource — reportSource is REQUIRED when updating a report and must be one of EA, MOB, OTHER, SE, TR, UI.

Quick expenses (v4): expenseTypeId (required), transactionAmount as { currencyCode, value } (required), transactionDate as YYYY-MM-DD (required), plus optional comment, vendor, paymentTypeId (CASHX, CPAID or PENDC) and location as { city, countryCode, countrySubDivisionCode }.

Travel requests and expected expenses (Request v4): name, businessPurpose, startDate, endDate, startTime, endTime, policy as { id }, mainDestination as { city, countryCode, countrySubDivisionCode }, expenseType, transactionDate, and custom1 through custom20. Amounts here are { value, currency } — this family uses currency, NOT currencyCode. Never send an id field on create.

SCIM users (Identity v4.1): create and update payloads use schemas, userName, name.givenName, name.familyName, emails, active, and companyId inside urn:ietf:params:scim:schemas:extension:enterprise:2.0:User. Update uses urn:ietf:params:scim:api:messages:2.0:PatchOp with Operations. Search payloads use schemas with urn:ietf:params:scim:api:messages:concur:2.0:SearchRequest plus filter, count, attributes and cursor — startIndex is NOT supported as a request parameter.

List items: listId, level, value, shortCode. Cash advances: amountRequested as { currency, amount }, name and userId (all required), plus optional accountCode, comment and purpose.

Exchange rates are the one snake_case family: currency_sets as an array of up to 100 entries, each { from_crn_code, to_crn_code, start_date as YYYY-MM-DD, rate }.

Omit fields the user did not describe rather than inventing identifiers.

Return ONLY the JSON object - no explanations, no extra text.`,
        placeholder:
          'Describe the payload in plain language (e.g., "a $42 taxi in USD on March 3")',
        generationType: 'json-object',
      },
      condition: { field: 'operation', value: BODY_OPS },
      required: {
        field: 'operation',
        value: [
          'sap_concur_create_expense_report',
          'sap_concur_update_expense_report',
          'sap_concur_send_back_expense_report',
          'sap_concur_update_expense',
          'sap_concur_update_allocation',
          'sap_concur_associate_attendees',
          'sap_concur_create_quick_expense',
          'sap_concur_create_quick_expense_with_image',
          'sap_concur_create_travel_request',
          'sap_concur_update_travel_request',
          'sap_concur_create_expected_expense',
          'sap_concur_update_expected_expense',
          'sap_concur_create_cash_advance',
          'sap_concur_create_user',
          'sap_concur_update_user',
          'sap_concur_search_users',
          'sap_concur_create_purchase_request',
          'sap_concur_upload_exchange_rates',
          'sap_concur_create_list_item',
          'sap_concur_update_list_item',
        ],
      },
    },
  ],
  tools: {
    access: [
      'sap_concur_approve_expense_report',
      'sap_concur_associate_attendees',
      'sap_concur_create_cash_advance',
      'sap_concur_create_expected_expense',
      'sap_concur_create_expense_report',
      'sap_concur_create_list_item',
      'sap_concur_create_purchase_request',
      'sap_concur_create_quick_expense',
      'sap_concur_create_quick_expense_with_image',
      'sap_concur_create_report_comment',
      'sap_concur_create_travel_request',
      'sap_concur_create_user',
      'sap_concur_delete_expected_expense',
      'sap_concur_delete_expense',
      'sap_concur_delete_expense_report',
      'sap_concur_delete_list_item',
      'sap_concur_delete_travel_request',
      'sap_concur_delete_user',
      'sap_concur_get_allocation',
      'sap_concur_get_budget',
      'sap_concur_get_cash_advance',
      'sap_concur_upload_exchange_rates',
      'sap_concur_get_expected_expense',
      'sap_concur_get_expense',
      'sap_concur_get_expense_report',
      'sap_concur_get_itemizations',
      'sap_concur_get_itinerary',
      'sap_concur_get_list',
      'sap_concur_get_list_item',
      'sap_concur_get_purchase_request',
      'sap_concur_get_receipt',
      'sap_concur_get_receipt_status',
      'sap_concur_get_travel_profile',
      'sap_concur_get_travel_request',
      'sap_concur_get_user',
      'sap_concur_issue_cash_advance',
      'sap_concur_list_allocations',
      'sap_concur_list_attendee_associations',
      'sap_concur_list_budget_categories',
      'sap_concur_list_budgets',
      'sap_concur_list_exceptions',
      'sap_concur_list_expected_expenses',
      'sap_concur_list_expenses',
      'sap_concur_list_expense_reports',
      'sap_concur_list_itineraries',
      'sap_concur_list_lists',
      'sap_concur_list_list_items',
      'sap_concur_list_receipts',
      'sap_concur_list_report_comments',
      'sap_concur_list_reports_to_approve',
      'sap_concur_get_request_cash_advance',
      'sap_concur_list_travel_profiles_summary',
      'sap_concur_list_travel_request_comments',
      'sap_concur_list_travel_requests',
      'sap_concur_list_users',
      'sap_concur_move_travel_request',
      'sap_concur_recall_expense_report',
      'sap_concur_remove_all_attendees',
      'sap_concur_search_locations',
      'sap_concur_search_users',
      'sap_concur_send_back_expense_report',
      'sap_concur_submit_expense_report',
      'sap_concur_update_allocation',
      'sap_concur_update_expected_expense',
      'sap_concur_update_expense',
      'sap_concur_update_expense_report',
      'sap_concur_update_list_item',
      'sap_concur_update_travel_request',
      'sap_concur_update_user',
      'sap_concur_upload_receipt_image',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const auth = {
          datacenter: params.datacenter || undefined,
          grantType: params.grantType || undefined,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          username: params.username || undefined,
          password: params.password || undefined,
          companyUuid: params.companyUuid || undefined,
        }

        const limit = params.limit ? Number(params.limit) : undefined
        const offset = params.offset ? Number(params.offset) : undefined
        const start = params.start ? Number(params.start) : undefined
        const count = params.count ? Number(params.count) : undefined
        const page = params.page ? Number(params.page) : undefined
        const contextType = clampContextType(params.operation, params.contextType)

        switch (params.operation) {
          case 'sap_concur_list_expense_reports':
            return {
              ...auth,
              user: params.expenseReportUser || undefined,
              submitDateBefore: params.submitDateBefore || undefined,
              submitDateAfter: params.submitDateAfter || undefined,
              paidDateBefore: params.paidDateBefore || undefined,
              paidDateAfter: params.paidDateAfter || undefined,
              modifiedDateBefore: params.modifiedDateBefore || undefined,
              modifiedDateAfter: params.modifiedDateAfter || undefined,
              createDateBefore: params.createDateBefore || undefined,
              createDateAfter: params.createDateAfter || undefined,
              approvalStatusCode: params.approvalStatusCode || undefined,
              paymentStatusCode: params.paymentStatusCode || undefined,
              currencyCode: params.currencyCode || undefined,
              approverLoginID: params.approverLoginID || undefined,
              limit,
              offset: params.offset ? String(params.offset) : undefined,
            }
          case 'sap_concur_get_expense_report':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
            }
          case 'sap_concur_create_expense_report':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              body: params.body,
            }
          case 'sap_concur_update_expense_report':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              body: params.body,
            }
          case 'sap_concur_delete_expense_report':
            return { ...auth, reportId: params.reportId }
          case 'sap_concur_submit_expense_report':
            return {
              ...auth,
              userId: params.userId,
              reportId: params.reportId,
            }
          case 'sap_concur_recall_expense_report':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
            }
          case 'sap_concur_approve_expense_report':
          case 'sap_concur_send_back_expense_report':
            return {
              ...auth,
              reportId: params.reportId,
              body: params.body || undefined,
            }
          case 'sap_concur_list_reports_to_approve':
            return {
              ...auth,
              userId: params.userId,
              contextType: 'MANAGER',
              sort: params.reportsToApproveSort || undefined,
              order: params.reportsToApproveOrder || undefined,
              includeDelegateApprovals: toBool(params.includeDelegateApprovals),
            }
          case 'sap_concur_list_expenses':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
            }
          case 'sap_concur_get_expense':
          case 'sap_concur_get_itemizations':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_update_expense':
            return {
              ...auth,
              reportId: params.reportId,
              expenseId: params.expenseId,
              body: params.body,
            }
          case 'sap_concur_delete_expense':
            return {
              ...auth,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_list_allocations':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_get_allocation':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              allocationId: params.allocationId,
            }
          case 'sap_concur_update_allocation':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              allocationId: params.allocationId,
              body: params.body,
            }
          case 'sap_concur_list_attendee_associations':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_associate_attendees':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
              body: params.body,
            }
          case 'sap_concur_remove_all_attendees':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_list_report_comments':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              includeAllComments: toBool(params.includeAllComments),
            }
          case 'sap_concur_create_report_comment':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              comment: params.comment,
            }
          case 'sap_concur_list_exceptions':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              reportId: params.reportId,
              excludeExpenses: toBool(params.excludeExpenses),
            }
          case 'sap_concur_create_quick_expense':
            return {
              ...auth,
              userId: params.userId,
              contextType,
              body: params.body,
            }
          case 'sap_concur_list_receipts':
            return { ...auth, userId: params.userId }
          case 'sap_concur_get_receipt':
          case 'sap_concur_get_receipt_status':
            return { ...auth, receiptId: params.receiptId }
          case 'sap_concur_list_travel_requests':
            return {
              ...auth,
              view: params.view || undefined,
              limit,
              start,
              userId: params.travelRequestUserId || undefined,
              approvedBefore: params.travelRequestApprovedBefore || undefined,
              approvedAfter: params.travelRequestApprovedAfter || undefined,
              modifiedBefore: params.travelRequestModifiedBefore || undefined,
              modifiedAfter: params.travelRequestModifiedAfter || undefined,
              sortField: params.travelRequestSortField || undefined,
              sortOrder:
                params.travelRequestSortOrder === 'asc' || params.travelRequestSortOrder === 'desc'
                  ? params.travelRequestSortOrder
                  : undefined,
            }
          case 'sap_concur_get_travel_request':
          case 'sap_concur_delete_travel_request':
            return {
              ...auth,
              requestUuid: params.requestUuid,
              userId: params.travelRequestUserId || undefined,
            }
          case 'sap_concur_create_travel_request':
            return { ...auth, body: params.body, userId: params.travelRequestUserId || undefined }
          case 'sap_concur_update_travel_request':
            return {
              ...auth,
              requestUuid: params.requestUuid,
              body: params.body,
              userId: params.travelRequestUserId || undefined,
            }
          case 'sap_concur_move_travel_request':
            return {
              ...auth,
              requestUuid: params.requestUuid,
              action: params.action,
              body: params.body || undefined,
              userId: params.travelRequestUserId || undefined,
              companyID: params.companyID || undefined,
              comment:
                params.action === 'sendback' ? params.sendbackComment || undefined : undefined,
            }
          case 'sap_concur_list_travel_request_comments':
            return { ...auth, requestUuid: params.requestUuid }
          case 'sap_concur_list_expected_expenses':
            return {
              ...auth,
              requestUuid: params.requestUuid,
              userId: params.expectedExpenseUserId || undefined,
            }
          case 'sap_concur_get_request_cash_advance':
            return { ...auth, cashAdvanceUuid: params.cashAdvanceUuid }
          case 'sap_concur_create_expected_expense':
            return {
              ...auth,
              requestUuid: params.requestUuid,
              body: params.body,
              userId: params.expectedExpenseUserId || undefined,
            }
          case 'sap_concur_get_expected_expense':
          case 'sap_concur_delete_expected_expense':
            return {
              ...auth,
              expenseUuid: params.expenseUuid,
              userId: params.expectedExpenseUserId || undefined,
            }
          case 'sap_concur_update_expected_expense':
            return {
              ...auth,
              expenseUuid: params.expenseUuid,
              body: params.body,
              userId: params.expectedExpenseUserId || undefined,
            }
          case 'sap_concur_create_cash_advance':
            return { ...auth, body: params.body }
          case 'sap_concur_get_cash_advance':
            return { ...auth, cashAdvanceId: params.cashAdvanceId }
          case 'sap_concur_issue_cash_advance':
            return {
              ...auth,
              cashAdvanceId: params.cashAdvanceId,
              body: params.body || undefined,
            }
          case 'sap_concur_list_itineraries':
            return {
              ...auth,
              startDate: params.startDate || undefined,
              endDate: params.endDate || undefined,
              bookingType: params.bookingType || undefined,
              useridType: params.useridType || undefined,
              useridValue: params.useridValue || undefined,
              itemsPerPage: params.itineraryItemsPerPage
                ? Number(params.itineraryItemsPerPage)
                : undefined,
              page: params.itineraryPage ? Number(params.itineraryPage) : undefined,
              includeMetadata: toBool(params.includeMetadata),
              includeCanceledTrips: toBool(params.includeCanceledTrips),
              includeVirtualTrip: params.includeVirtualTrip || undefined,
              includeGuestBookings: toBool(params.includeGuestBookings),
              createdAfterDate: params.createdAfterDate || undefined,
              createdBeforeDate: params.createdBeforeDate || undefined,
              lastModifiedDate: params.itineraryLastModifiedDate || undefined,
            }
          case 'sap_concur_get_itinerary':
            return {
              ...auth,
              tripId: params.tripId,
              useridType: params.useridType || undefined,
              useridValue: params.useridValue || undefined,
              systemFormat: params.systemFormat || undefined,
            }
          case 'sap_concur_list_users':
            return {
              ...auth,
              count,
              cursor: params.usersCursor || undefined,
              attributes: params.attributes || undefined,
              excludedAttributes: params.excludedAttributes || undefined,
            }
          case 'sap_concur_get_user':
            return {
              ...auth,
              userUuid: params.userUuid,
              attributes: params.attributes || undefined,
              excludedAttributes: params.excludedAttributes || undefined,
            }
          case 'sap_concur_delete_user':
            return { ...auth, userUuid: params.userUuid }
          case 'sap_concur_create_user':
            return { ...auth, body: params.body }
          case 'sap_concur_update_user':
            return { ...auth, userUuid: params.userUuid, body: params.body }
          case 'sap_concur_search_users':
            return { ...auth, body: params.body }
          case 'sap_concur_list_lists':
            return {
              ...auth,
              page,
              sortBy: clampSortBy(params.operation, params.sortBy),
              sortDirection: params.sortDirection || undefined,
              value: params.value || undefined,
              categoryType: params.categoryType || undefined,
              isDeleted: params.isDeleted || undefined,
              levelCount: params.levelCount || undefined,
            }
          case 'sap_concur_get_list':
            return { ...auth, listId: params.listId }
          case 'sap_concur_list_list_items':
            return {
              ...auth,
              listId: params.listId,
              page,
              sortBy: clampSortBy(params.operation, params.sortBy),
              sortDirection: params.sortDirection || undefined,
              hasChildren: toBool(params.hasChildren),
              isDeleted: params.isDeleted || undefined,
              shortCode: params.shortCode || undefined,
              value: params.value || undefined,
              shortCodeOrValue: params.shortCodeOrValue || undefined,
            }
          case 'sap_concur_get_list_item':
            return {
              ...auth,
              itemId: params.itemId,
            }
          case 'sap_concur_list_budgets':
            return {
              ...auth,
              adminView: toBool(params.adminView),
              offset,
              responseSchema: params.responseSchema || undefined,
            }
          case 'sap_concur_get_budget':
            return { ...auth, budgetId: params.budgetId }
          case 'sap_concur_list_budget_categories':
            return { ...auth }
          case 'sap_concur_upload_exchange_rates':
            return { ...auth, body: params.body }
          case 'sap_concur_create_purchase_request':
            return { ...auth, body: params.body }
          case 'sap_concur_get_purchase_request':
            return { ...auth, purchaseRequestId: params.purchaseRequestId }
          case 'sap_concur_create_list_item':
            return { ...auth, body: params.body }
          case 'sap_concur_update_list_item':
            return { ...auth, itemId: params.itemId, body: params.body }
          case 'sap_concur_delete_list_item':
            return { ...auth, itemId: params.itemId }
          case 'sap_concur_get_travel_profile':
            return {
              ...auth,
              useridType: params.useridType || undefined,
              useridValue: params.useridValue || undefined,
            }
          case 'sap_concur_list_travel_profiles_summary':
            return {
              ...auth,
              lastModifiedDate: params.lastModifiedDate,
              page: params.travelProfilePage ? Number(params.travelProfilePage) : undefined,
              itemsPerPage: params.itemsPerPage ? Number(params.itemsPerPage) : undefined,
              travelConfigs: params.travelConfigs || undefined,
              active: params.active || undefined,
            }
          case 'sap_concur_search_locations':
            return {
              ...auth,
              searchText: params.searchText || undefined,
              locCode: params.locCode || undefined,
              locationNameId: params.locationNameId || undefined,
              locationNameKey: params.locationNameKey ? Number(params.locationNameKey) : undefined,
              countryCode: params.countryCode || undefined,
              subdivisionCode: params.subdivisionCode || undefined,
              adminRegionId: params.adminRegionId || undefined,
            }
          case 'sap_concur_upload_receipt_image': {
            const normalizedReceipt = normalizeFileInput(params.receipt, { single: true }) as
              | UserFileLike
              | undefined
            return {
              ...auth,
              userId: params.userId,
              receipt: normalizedReceipt,
            }
          }
          case 'sap_concur_create_quick_expense_with_image': {
            const normalizedReceipt = normalizeFileInput(params.receipt, { single: true }) as
              | UserFileLike
              | undefined
            return {
              ...auth,
              userId: params.userId,
              contextType,
              receipt: normalizedReceipt,
              body: params.body,
            }
          }
          default:
            throw new Error(`Unsupported SAP Concur operation: ${params.operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    datacenter: { type: 'string', description: 'Concur datacenter base URL' },
    grantType: { type: 'string', description: 'OAuth grant type' },
    clientId: { type: 'string', description: 'OAuth client ID' },
    clientSecret: { type: 'string', description: 'OAuth client secret' },
    username: { type: 'string', description: 'Username (password grant only)' },
    password: { type: 'string', description: 'Password (password grant only)' },
    companyUuid: { type: 'string', description: 'Company UUID for multi-company tokens' },
    userId: { type: 'string', description: 'Concur user UUID' },
    contextType: {
      type: 'string',
      description:
        'Access context, clamped per operation to the values that operation accepts (TRAVELER/MANAGER/PROCESSOR/PROXY for get expense report, TRAVELER/MANAGER/PROXY for get expense, exceptions and report comments, TRAVELER/MANAGER for list allocations, TRAVELER/PROXY for single allocations, attendees and report create/update/recall, TRAVELER only for list expenses, itemizations and quick expenses)',
    },
    reportId: { type: 'string', description: 'Expense report ID' },
    expenseId: { type: 'string', description: 'Expense entry ID' },
    allocationId: { type: 'string', description: 'Allocation ID' },
    expenseReportUser: {
      type: 'string',
      description: 'v3 list expense reports — user filter (login id)',
    },
    submitDateBefore: {
      type: 'string',
      description: 'v3 list expense reports — submit date before',
    },
    submitDateAfter: { type: 'string', description: 'v3 list expense reports — submit date after' },
    paidDateBefore: { type: 'string', description: 'v3 list expense reports — paid date before' },
    paidDateAfter: { type: 'string', description: 'v3 list expense reports — paid date after' },
    modifiedDateBefore: {
      type: 'string',
      description: 'v3 list expense reports — modified date before',
    },
    modifiedDateAfter: {
      type: 'string',
      description: 'v3 list expense reports — modified date after',
    },
    createDateBefore: {
      type: 'string',
      description: 'v3 list expense reports — create date before',
    },
    createDateAfter: {
      type: 'string',
      description: 'v3 list expense reports — create date after',
    },
    approvalStatusCode: {
      type: 'string',
      description: 'v3 list expense reports — approval status code',
    },
    paymentStatusCode: {
      type: 'string',
      description: 'v3 list expense reports — payment status code',
    },
    currencyCode: { type: 'string', description: 'v3 list expense reports — currency code' },
    approverLoginID: { type: 'string', description: 'v3 list expense reports — approver login id' },
    comment: { type: 'string', description: 'Comment text' },
    receiptId: { type: 'string', description: 'Receipt image ID' },
    requestUuid: { type: 'string', description: 'Travel request UUID' },
    view: { type: 'string', description: 'Travel request view filter' },
    travelRequestUserId: {
      type: 'string',
      description:
        "Optional user UUID for travel request impersonation/filter. On Update Travel Request it is taken into account only when calling with a Company token; if not provided the update is performed as 'Concur System'",
    },
    companyID: {
      type: 'string',
      description:
        'Optional company identifier for a travel request workflow action (documented as companyID, distinct from companyUuid)',
    },
    sendbackComment: {
      type: 'string',
      description:
        'Optional comment on a travel request workflow action — Concur applies it only to the sendback action, and it is visible wherever Request comments are shown',
    },
    travelRequestApprovedBefore: { type: 'string', description: 'Travel requests approved before' },
    travelRequestApprovedAfter: { type: 'string', description: 'Travel requests approved after' },
    travelRequestModifiedBefore: { type: 'string', description: 'Travel requests modified before' },
    travelRequestModifiedAfter: { type: 'string', description: 'Travel requests modified after' },
    travelRequestSortField: { type: 'string', description: 'Travel requests sort field' },
    travelRequestSortOrder: { type: 'string', description: 'Travel requests sort order' },
    action: { type: 'string', description: 'Travel request workflow action' },
    expectedExpenseUserId: {
      type: 'string',
      description: 'Expected expense impersonation user UUID',
    },
    expenseUuid: { type: 'string', description: 'Expected expense UUID' },
    cashAdvanceId: { type: 'string', description: 'Cash advance ID' },
    cashAdvanceUuid: { type: 'string', description: 'Cash advance UUID (travel request scope)' },
    tripId: { type: 'string', description: 'Trip/itinerary ID' },
    startDate: { type: 'string', description: 'Itinerary start date filter' },
    endDate: { type: 'string', description: 'Itinerary end date filter' },
    bookingType: { type: 'string', description: 'Itinerary booking type filter' },
    systemFormat: {
      type: 'string',
      description: 'Itinerary system format — the only supported value is Tripit',
    },
    itineraryItemsPerPage: { type: 'number', description: 'Itinerary items per page' },
    itineraryPage: { type: 'number', description: 'Itinerary page number' },
    includeMetadata: { type: 'boolean', description: 'Include itinerary paging metadata' },
    includeCanceledTrips: { type: 'boolean', description: 'Include canceled trips' },
    includeVirtualTrip: {
      type: 'string',
      description: 'Set to 1 to include virtual trips carrying Request-booked offline segments',
    },
    includeGuestBookings: {
      type: 'boolean',
      description: 'Include trips booked on behalf of guests (defaults to false)',
    },
    createdAfterDate: { type: 'string', description: 'Itinerary created-after date' },
    createdBeforeDate: { type: 'string', description: 'Itinerary created-before date' },
    itineraryLastModifiedDate: { type: 'string', description: 'Itinerary last-modified date' },
    userUuid: { type: 'string', description: 'User identity UUID' },
    count: { type: 'number', description: 'SCIM count' },
    usersCursor: { type: 'string', description: 'SCIM v4.1 cursor for /users' },
    attributes: { type: 'string', description: 'SCIM attributes filter' },
    excludedAttributes: { type: 'string', description: 'SCIM excluded attributes' },
    listId: { type: 'string', description: 'Custom list ID' },
    itemId: { type: 'string', description: 'List item v4 UUID' },
    sortBy: { type: 'string', description: 'Sort field for v4 lists/items endpoints' },
    sortDirection: { type: 'string', description: 'Sort direction: asc or desc' },
    value: { type: 'string', description: 'Filter by value/name for v4 lists/items endpoints' },
    categoryType: { type: 'string', description: 'List category.type filter' },
    isDeleted: {
      type: 'string',
      description: 'Include deleted lists/items — accepts true, false, or an operator form',
    },
    levelCount: {
      type: 'string',
      description: 'Filter lists by level count — accepts an exact count or eq:/gt:/gte:/lt:/lte:',
    },
    hasChildren: { type: 'boolean', description: 'Filter list items that have children' },
    shortCode: { type: 'string', description: 'Filter list items by short code' },
    shortCodeOrValue: { type: 'string', description: 'Filter list items by short code or value' },
    budgetId: { type: 'string', description: 'Budget header ID' },
    adminView: { type: 'boolean', description: 'Return all admin-visible budgets' },
    responseSchema: { type: 'string', description: 'Budget response schema (COMPACT)' },
    purchaseRequestId: { type: 'string', description: 'Purchase request ID' },
    limit: { type: 'number', description: 'Max records per page' },
    offset: { type: 'number', description: 'Page offset' },
    start: { type: 'number', description: 'Page start cursor (offset)' },
    body: { type: 'json', description: 'JSON request body' },
    useridType: { type: 'string', description: 'Travel profile identifier type' },
    useridValue: { type: 'string', description: 'Travel profile identifier value' },
    lastModifiedDate: { type: 'string', description: 'Required ISO date for profile summary' },
    page: { type: 'number', description: 'Page number (lists/list_items)' },
    travelProfilePage: { type: 'number', description: 'Profile summary page number' },
    itemsPerPage: { type: 'number', description: 'Profile summary items per page' },
    travelConfigs: { type: 'string', description: 'Comma-separated travel config ids' },
    active: {
      type: 'string',
      description: 'Travel profile summary user state filter — 1 for active, 0 for inactive',
    },
    searchText: { type: 'string', description: 'Locations v5 free-text search' },
    locCode: { type: 'string', description: 'Locations v5 location code' },
    locationNameId: { type: 'string', description: 'Locations v5 location name id' },
    locationNameKey: { type: 'number', description: 'Locations v5 numeric location name key' },
    countryCode: { type: 'string', description: 'Locations v5 ISO 3166-1 country code' },
    subdivisionCode: { type: 'string', description: 'Locations v5 ISO 3166-2 subdivision code' },
    adminRegionId: { type: 'string', description: 'Locations v5 administrative region id' },
    receipt: { type: 'json', description: 'Receipt image file (canonical param)' },
    reportsToApproveSort: {
      type: 'string',
      description: 'Sort field for reportsToApprove (e.g., reportDate)',
    },
    reportsToApproveOrder: { type: 'string', description: 'Sort order: asc or desc' },
    includeDelegateApprovals: {
      type: 'boolean',
      description: 'Include reports the caller can approve as a delegate',
    },
    includeAllComments: {
      type: 'boolean',
      description: 'Include comments from all expenses in the report',
    },
    excludeExpenses: {
      type: 'boolean',
      description:
        'Return only report-header exceptions, excluding expense-level and allocation-level ones',
    },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description:
        'Concur API response payload. Shape follows the operation: expense report headers (reportId, name, ownerName, approvalStatusName, paymentStatusName, reportTotal, currencyCode, submitDate); expense entries (expenseId, expenseTypeName, transactionDate, transactionAmount, vendorDescription, isPersonal); itemizations and allocations (allocationId, percentage, amount, custom fields); attendee associations (attendeeId, associatedAmount); report comments (author, text, isLatest); policy exceptions (code, level, message); quick expenses and receipts (quickExpenseIdUri, receiptId, imageId, status); travel requests (requestId, requestUuid, name, approvalStatus, totalApprovedAmount, startDate, endDate) and expected expenses (expenseUuid, expenseType, transactionAmount); cash advances (cashAdvanceId, amount, currencyCode, status); itineraries, which come back as a raw Concur XML string rather than JSON; SCIM user resources (id, userName, displayName, emails, active, meta); custom lists and list items (listId, itemId, level, value, shortCode); budget item headers and categories (budgetId, name, spent, remaining); and locations (locationNameId, locCode, countryCode, subdivisionCode).',
    },
  },
}

export const SapConcurBlockMeta = {
  tags: ['automation', 'payments'],
  url: 'https://www.concur.com',
  templates: [
    {
      icon: SapConcurIcon,
      title: 'SAP Concur expense classifier',
      prompt:
        'Build a scheduled workflow that polls SAP Concur for newly submitted expense reports, classifies each line item, validates against policy, and routes exceptions to the approver in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur policy auditor',
      prompt:
        'Create a scheduled monthly workflow that audits SAP Concur expense reports against policy, flags pattern violations by employee, and writes a compliance report.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur travel pre-approval',
      prompt:
        'Build a scheduled workflow that polls SAP Concur for pending travel requests, routes each to the right approver based on amount and destination, captures the decision over Microsoft Teams, and moves the request to the approved or sent-back state.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur receipt OCR',
      prompt:
        'Create a workflow that processes SAP Concur receipt images with AWS Textract, validates the extracted vendor and amount against the report line, and flags mismatches.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['textract'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur reimbursement chaser',
      prompt:
        'Build a scheduled workflow that finds SAP Concur reports stuck pending more than 7 days, sends the approver a reminder, and writes the chase log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur travel reconciler',
      prompt:
        'Create a workflow that reconciles SAP Concur travel bookings with corporate card transactions, flags missing receipts, and writes a reconciliation table for finance.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur budget watcher',
      prompt:
        'Build a scheduled monthly workflow that aggregates SAP Concur spend per department, compares against budget, and pings managers in Teams when overspend is projected.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'review-expense-reports',
      description:
        'List submitted SAP Concur expense reports, inspect line items, and flag policy exceptions.',
      content:
        '# Review Expense Reports\n\nSurface expense reports that need attention and check them against policy.\n\n## Steps\n1. Run List Expense Reports to pull recently submitted reports, or List Reports To Approve for items awaiting the current approver.\n2. For each report of interest, run Get Expense Report and List Expenses to read the individual line items, then List Exceptions to see Concur policy flags.\n3. Summarize totals, flagged line items, and any missing receipts.\n\n## Output\nReturn a per-report summary with the report ID, owner, total amount, and a list of policy exceptions or anomalies that warrant follow-up.',
    },
    {
      name: 'route-report-approval',
      description: 'Approve or send back a submitted SAP Concur expense report after review.',
      content:
        '# Route Report Approval\n\nAct on an expense report once a review decision is made.\n\n## Steps\n1. Confirm the report ID and the decision.\n2. To approve, run Approve Expense Report. To return it for correction, run Send Back Expense Report with a clear comment explaining what must change.\n3. Optionally run Create Report Comment first to leave context for the submitter.\n\n## Output\nConfirm the report ID, the action taken (approved or sent back), and the comment provided so the decision is auditable.',
    },
    {
      name: 'capture-quick-expense',
      description:
        'Create a quick expense in SAP Concur from a receipt, attaching the receipt image.',
      content:
        '# Capture Quick Expense\n\nLog an out-of-pocket expense quickly, with the receipt attached.\n\n## Steps\n1. If you have a receipt image, use Create Quick Expense (With Image) to upload it and create the expense in one step. To upload on its own, run Upload Receipt Image — it returns no receipt ID, only a `location` URL and a raw `link` header of the form `<https://{datacenter}/receipts/v4/status/{id}>; rel="processing-status"`. Parse the id out of that URL.\n2. Run Create Quick Expense with the vendor, amount, currency, and transaction date.\n3. To check the upload, run Get Receipt Status with the id from step 1 — that is the only working post-upload read. Do not use List Receipts or Get Receipt: they read the e-receipt family, while Upload Receipt Image writes to the disjoint image-only family, so a freshly uploaded image never appears in List Receipts and Get Receipt on its id returns 404. Reading back the image-only receipt itself requires endpoints this integration does not yet wrap.\n4. A quick expense is not attached to a report yet, so Get Expense cannot read it. Once it has been moved onto a report, List Expenses on that report ID shows the entry.\n\n## Output\nReport the created quick expense ID, the captured vendor and amount, and the receipt processing status if an image was uploaded.',
    },
    {
      name: 'manage-travel-requests',
      description:
        'List and act on SAP Concur travel requests, moving them through the approval workflow.',
      content:
        '# Manage Travel Requests\n\nHandle pre-trip travel requests through their approval lifecycle.\n\n## Steps\n1. Run List Travel Requests to find pending requests, then Get Travel Request for full detail on a specific one.\n2. Review the expected expenses and any linked cash advance via Get Request Cash Advance.\n3. Run Move Travel Request (Workflow Action) to advance, approve, or send back the request based on the decision.\n\n## Output\nReturn the travel request ID, destination, estimated cost, and the workflow action applied so the trip approval state is clear.',
    },
    {
      name: 'provision-concur-user-identity',
      description:
        'Create, update, search, and deactivate SAP Concur user identities through the SCIM Identity API.',
      content:
        '# Provision Concur User Identity\n\nRun the joiner, mover, and leaver steps against the SAP Concur Identity (SCIM) API.\n\n## Steps\n1. Run Search Users with a SCIM search body (filter on userName or emails.value) to check whether the person already exists, or List Users with Attributes set to a narrow field list when scanning the directory.\n2. To onboard, run Create User with the SCIM body — schemas, userName, name.givenName, name.familyName, emails, and active.\n3. To change a role, department, or manager, run Update User (PATCH) against the user UUID, then confirm with Get User.\n4. To offboard, prefer Update User (PATCH) setting active to false; use Delete User only when the identity must be removed outright.\n\n## Output\nReport the user UUID, userName, the change applied, and the resulting active state so the identity lifecycle is auditable.',
    },
    {
      name: 'maintain-concur-custom-lists',
      description:
        'Browse and edit SAP Concur custom lists and their items — the value sets behind list-type expense fields.',
      content:
        '# Maintain Concur Custom Lists\n\nKeep the value sets behind list-type expense and request fields current.\n\n## Steps\n1. Run List Lists to find the list you need, filtering by Value or Category Type; note that on List Lists the Value and Level Count filters accept operator prefixes (sw:, ew:, not:, cp: on Value; eq:, gt:, gte:, lt:, lte: on Level Count), while Is Deleted accepts only eq:.\n2. Run Get List for the definition, then List List Items with the list ID to page through its current entries — there Value, Short Code, and Short Code Or Value take the same string operator prefixes.\n3. Run Create List Item to add a value, Update List Item to correct one, and Delete List Item to retire one. Read a single entry back with Get List Item.\n\n## Output\nReturn the list ID and name, the items added, changed, or retired with their short codes and values, and the level each item sits at.',
    },
    {
      name: 'track-budget-consumption',
      description:
        'Read SAP Concur budget item headers and categories to see how much of each budget is already consumed.',
      content:
        '# Track Budget Consumption\n\nCheck spend against the budgets configured in SAP Concur.\n\n## Steps\n1. Run List Budget Categories to learn how budgets are grouped for the company.\n2. Run List Budgets to page through budget item headers; enable Admin View to see every budget the credentials can administer, and set Response Schema to COMPACT for a lighter payload.\n3. Run Get Budget on any header of interest for the full detail, including the spent and remaining amounts.\n\n## Output\nReturn each budget header ID, its name and category, the budgeted amount, the amount consumed, and the remaining balance, calling out any budget already over its limit.',
    },
    {
      name: 'issue-cash-advance',
      description:
        'Create, inspect, and issue SAP Concur cash advances, including advances attached to a travel request.',
      content:
        '# Issue Cash Advance\n\nMove a cash advance from request through to issued funds.\n\n## Steps\n1. Run Create Cash Advance with the amount, currency code, and comment describing the need.\n2. Run Get Cash Advance on the returned ID to confirm the amount and current status, or Get Request Cash Advance when the advance hangs off a travel request UUID.\n3. Once approved, run Issue Cash Advance to record the disbursement, supplying the issued amount and exchange rate in the body when they differ from the request.\n\n## Output\nReturn the cash advance ID, requested and issued amounts with currency, the current status, and the linked travel request UUID when there is one.',
    },
  ],
} as const satisfies BlockMeta
