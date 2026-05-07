import { SapConcurIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
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
  'sap_concur_list_expense_reports',
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
  'sap_concur_list_expense_reports',
  'sap_concur_list_expenses',
  'sap_concur_get_expense',
  'sap_concur_get_itemizations',
  'sap_concur_list_exceptions',
]

const QUICK_EXPENSE_CONTEXT_TYPE_OPS = [
  'sap_concur_create_quick_expense',
  'sap_concur_create_quick_expense_with_image',
]

const MANAGER_ONLY_CONTEXT_TYPE_OPS = ['sap_concur_list_reports_to_approve']

const ATTENDEE_CONTEXT_TYPE_OPS = [
  'sap_concur_list_attendee_associations',
  'sap_concur_associate_attendees',
  'sap_concur_remove_all_attendees',
  'sap_concur_create_report_comment',
  'sap_concur_list_report_comments',
]

const ALLOCATION_CONTEXT_TYPE_OPS = [
  'sap_concur_list_allocations',
  'sap_concur_get_allocation',
  'sap_concur_update_allocation',
  'sap_concur_recall_expense_report',
  'sap_concur_create_expense_report',
  'sap_concur_update_expense_report',
]

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
  'sap_concur_submit_expense_report',
  'sap_concur_recall_expense_report',
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

export const SapConcurBlock: BlockConfig<SapConcurProxyResponse> = {
  type: 'sap_concur',
  name: 'SAP Concur',
  description: 'Manage expense reports, travel requests, cash advances, and more in SAP Concur',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect SAP Concur via OAuth 2.0. Manage expense reports and line items, allocations, attendees, comments, exceptions, quick expenses, receipts, travel requests and expected expenses, cash advances, itineraries, user identities, custom lists, budgets, exchange rates, and purchase requests across every Concur datacenter.',
  docsLink: 'https://docs.sim.ai/tools/sap_concur',
  category: 'tools',
  integrationType: IntegrationType.Other,
  tags: ['automation'],
  bgColor: '#FFFFFF',
  icon: SapConcurIcon,
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
        { label: 'US (us.api.concursolutions.com)', id: 'us.api.concursolutions.com' },
        { label: 'US 2 (us2.api.concursolutions.com)', id: 'us2.api.concursolutions.com' },
        { label: 'EU (eu.api.concursolutions.com)', id: 'eu.api.concursolutions.com' },
        { label: 'EU 2 (eu2.api.concursolutions.com)', id: 'eu2.api.concursolutions.com' },
        { label: 'EMEA (emea.api.concursolutions.com)', id: 'emea.api.concursolutions.com' },
        { label: 'CN (cn.api.concursolutions.com)', id: 'cn.api.concursolutions.com' },
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
      placeholder: 'Username (password grant only)',
      condition: { field: 'grantType', value: 'password' },
      required: { field: 'grantType', value: 'password' },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Password (password grant only)',
      password: true,
      condition: { field: 'grantType', value: 'password' },
      required: { field: 'grantType', value: 'password' },
    },
    {
      id: 'companyUuid',
      title: 'Company UUID',
      type: 'short-input',
      placeholder: 'Multi-company access token UUID (optional)',
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
      condition: { field: 'operation', value: QUICK_EXPENSE_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: QUICK_EXPENSE_CONTEXT_TYPE_OPS },
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
    {
      id: 'contextType',
      title: 'Context Type',
      type: 'dropdown',
      options: [{ label: 'MANAGER', id: 'MANAGER' }],
      value: () => 'MANAGER',
      condition: { field: 'operation', value: MANAGER_ONLY_CONTEXT_TYPE_OPS },
      required: { field: 'operation', value: MANAGER_ONLY_CONTEXT_TYPE_OPS },
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
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'paymentStatusCode',
      title: 'Payment Status Code',
      type: 'short-input',
      placeholder: 'P_NOTP, P_PAID...',
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
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'submitDateBefore',
      title: 'Submit Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'paidDateAfter',
      title: 'Paid Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'paidDateBefore',
      title: 'Paid Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'modifiedDateAfter',
      title: 'Modified Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'modifiedDateBefore',
      title: 'Modified Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'createDateAfter',
      title: 'Create Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_expense_reports' },
      mode: 'advanced',
    },
    {
      id: 'createDateBefore',
      title: 'Create Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
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
      id: 'includeAllComments',
      title: 'Include All Comments',
      type: 'switch',
      condition: { field: 'operation', value: 'sap_concur_list_report_comments' },
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
          'sap_concur_delete_travel_request',
          'sap_concur_move_travel_request',
        ],
      },
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
      placeholder: 'GDS',
      condition: { field: 'operation', value: 'sap_concur_get_itinerary' },
      mode: 'advanced',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
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
    },
    {
      id: 'itineraryPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
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
      id: 'createdAfterDate',
      title: 'Created After Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'createdBeforeDate',
      title: 'Created Before Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'sap_concur_list_itineraries' },
      mode: 'advanced',
    },
    {
      id: 'itineraryLastModifiedDate',
      title: 'Last Modified Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
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
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'sap_concur_list_users' },
    },
    {
      id: 'usersCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: { field: 'operation', value: 'sap_concur_list_users' },
    },
    {
      id: 'attributes',
      title: 'Attributes',
      type: 'short-input',
      placeholder: 'id,active,emails',
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
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'name',
      condition: {
        field: 'operation',
        value: ['sap_concur_list_lists', 'sap_concur_list_list_items'],
      },
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
    },
    {
      id: 'itemsPerPage',
      title: 'Items Per Page',
      type: 'short-input',
      placeholder: '200',
      condition: { field: 'operation', value: 'sap_concur_list_travel_profiles_summary' },
    },
    {
      id: 'travelConfigs',
      title: 'Travel Config IDs',
      type: 'short-input',
      placeholder: 'Comma-separated config ids',
      condition: { field: 'operation', value: 'sap_concur_list_travel_profiles_summary' },
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
    },
    {
      id: 'subdivisionCode',
      title: 'Subdivision Code (ISO 3166-2)',
      type: 'short-input',
      placeholder: 'US-WA',
      condition: { field: 'operation', value: 'sap_concur_search_locations' },
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
      required: true,
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
      required: true,
    },
    {
      id: 'forwardId',
      title: 'Forward ID',
      type: 'short-input',
      placeholder: 'Optional dedup id (max 40 chars)',
      condition: { field: 'operation', value: 'sap_concur_upload_receipt_image' },
      mode: 'advanced',
    },

    // Body (JSON payload) — shared across all create/update/action ops
    {
      id: 'body',
      title: 'Request Body (JSON)',
      type: 'long-input',
      placeholder: '{ ... }',
      condition: { field: 'operation', value: BODY_OPS },
      required: {
        field: 'operation',
        value: [
          'sap_concur_create_expense_report',
          'sap_concur_update_expense_report',
          'sap_concur_approve_expense_report',
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
        const startIndex = params.startIndex ? Number(params.startIndex) : undefined
        const page = params.page ? Number(params.page) : undefined
        const levelCount = params.levelCount ? Number(params.levelCount) : undefined

        switch (params.operation) {
          case 'sap_concur_list_expense_reports':
            return {
              ...auth,
              user: params.expenseReportUser || params.userId || undefined,
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
              contextType: params.contextType,
              reportId: params.reportId,
            }
          case 'sap_concur_create_expense_report':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              body: params.body,
            }
          case 'sap_concur_update_expense_report':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
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
              body: params.body || undefined,
            }
          case 'sap_concur_recall_expense_report':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              body: params.body || undefined,
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
              contextType: params.contextType,
              sort: params.reportsToApproveSort || undefined,
              order: params.reportsToApproveOrder || undefined,
              includeDelegateApprovals: toBool(params.includeDelegateApprovals),
            }
          case 'sap_concur_list_expenses':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
            }
          case 'sap_concur_get_expense':
          case 'sap_concur_get_itemizations':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
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
              contextType: params.contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_get_allocation':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              allocationId: params.allocationId,
            }
          case 'sap_concur_update_allocation':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              allocationId: params.allocationId,
              body: params.body,
            }
          case 'sap_concur_list_attendee_associations':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_associate_attendees':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
              body: params.body,
            }
          case 'sap_concur_remove_all_attendees':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              expenseId: params.expenseId,
            }
          case 'sap_concur_list_report_comments':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              includeAllComments: toBool(params.includeAllComments),
            }
          case 'sap_concur_create_report_comment':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
              comment: params.comment,
            }
          case 'sap_concur_list_exceptions':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
              reportId: params.reportId,
            }
          case 'sap_concur_create_quick_expense':
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
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
            return { ...auth, requestUuid: params.requestUuid, body: params.body }
          case 'sap_concur_move_travel_request':
            return {
              ...auth,
              requestUuid: params.requestUuid,
              action: params.action,
              body: params.body || undefined,
              userId: params.travelRequestUserId || undefined,
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
              sortBy: params.sortBy || undefined,
              sortDirection: params.sortDirection || undefined,
              value: params.value || undefined,
              categoryType: params.categoryType || undefined,
              isDeleted: toBool(params.isDeleted),
              levelCount,
            }
          case 'sap_concur_get_list':
            return { ...auth, listId: params.listId }
          case 'sap_concur_list_list_items':
            return {
              ...auth,
              listId: params.listId,
              page,
              sortBy: params.sortBy || undefined,
              sortDirection: params.sortDirection || undefined,
              hasChildren: toBool(params.hasChildren),
              isDeleted: toBool(params.isDeleted),
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
              forwardId: params.forwardId || undefined,
            }
          }
          case 'sap_concur_create_quick_expense_with_image': {
            const normalizedReceipt = normalizeFileInput(params.receipt, { single: true }) as
              | UserFileLike
              | undefined
            return {
              ...auth,
              userId: params.userId,
              contextType: params.contextType,
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
      description: 'Access context (TRAVELER/MANAGER, or TRAVELER/PROXY for allocations)',
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
      description: 'User UUID for travel request impersonation/filter',
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
    systemFormat: { type: 'string', description: 'Itinerary system format (e.g., GDS)' },
    itineraryItemsPerPage: { type: 'number', description: 'Itinerary items per page' },
    itineraryPage: { type: 'number', description: 'Itinerary page number' },
    includeMetadata: { type: 'boolean', description: 'Include itinerary paging metadata' },
    includeCanceledTrips: { type: 'boolean', description: 'Include canceled trips' },
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
    isDeleted: { type: 'boolean', description: 'Include deleted lists/items' },
    levelCount: { type: 'number', description: 'Filter lists by level count' },
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
    searchText: { type: 'string', description: 'Locations v5 free-text search' },
    locCode: { type: 'string', description: 'Locations v5 location code' },
    locationNameId: { type: 'string', description: 'Locations v5 location name id' },
    locationNameKey: { type: 'number', description: 'Locations v5 numeric location name key' },
    countryCode: { type: 'string', description: 'Locations v5 ISO 3166-1 country code' },
    subdivisionCode: { type: 'string', description: 'Locations v5 ISO 3166-2 subdivision code' },
    adminRegionId: { type: 'string', description: 'Locations v5 administrative region id' },
    receipt: { type: 'json', description: 'Receipt image file (canonical param)' },
    forwardId: { type: 'string', description: 'Optional dedup id for receipt upload' },
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
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: { type: 'json', description: 'Concur API response payload' },
  },
}
