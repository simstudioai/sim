import type { ToolResponse } from '@/tools/types'

export type SapConcurDatacenter =
  | 'us.api.concursolutions.com'
  | 'us2.api.concursolutions.com'
  | 'eu.api.concursolutions.com'
  | 'eu2.api.concursolutions.com'
  | 'cn.api.concursolutions.com'
  | 'emea.api.concursolutions.com'

export type SapConcurGrantType = 'client_credentials' | 'password'

export interface SapConcurBaseParams {
  datacenter?: SapConcurDatacenter
  grantType?: SapConcurGrantType
  clientId: string
  clientSecret: string
  username?: string
  password?: string
  companyUuid?: string
}

export interface ProxyOutput {
  status: number
  data: unknown
}

export interface SapConcurProxyResponse extends ToolResponse {
  output: ProxyOutput
}

export interface ListExpenseReportsParams extends SapConcurBaseParams {
  user?: string
  submitDateBefore?: string
  submitDateAfter?: string
  paidDateBefore?: string
  paidDateAfter?: string
  modifiedDateBefore?: string
  modifiedDateAfter?: string
  createDateBefore?: string
  createDateAfter?: string
  approvalStatusCode?: string
  paymentStatusCode?: string
  currencyCode?: string
  approverLoginID?: string
  limit?: number
  offset?: string
}

export interface GetExpenseReportParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'MANAGER' | 'PROCESSOR' | 'PROXY'
  reportId: string
}

export interface ListReportsToApproveParams extends SapConcurBaseParams {
  userId: string
  contextType?: 'MANAGER'
  sort?: string
  order?: string
  includeDelegateApprovals?: boolean
}

export interface CreateExpenseReportParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  body: Record<string, unknown> | string
}

export interface UpdateExpenseReportParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  body: Record<string, unknown> | string
}

export interface DeleteExpenseReportParams extends SapConcurBaseParams {
  reportId: string
}

export interface SubmitExpenseReportParams extends SapConcurBaseParams {
  userId: string
  reportId: string
  body?: Record<string, unknown> | string
}

export interface RecallExpenseReportParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  body?: Record<string, unknown> | string
}

export interface ApproveExpenseReportParams extends SapConcurBaseParams {
  reportId: string
  body: Record<string, unknown> | string
}

export interface SendBackExpenseReportParams extends SapConcurBaseParams {
  reportId: string
  body: Record<string, unknown> | string
}

export interface ListExpensesParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'MANAGER'
  reportId: string
}

export interface GetExpenseParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'MANAGER' | 'PROXY'
  reportId: string
  expenseId: string
}

export interface GetItemizationsParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'MANAGER'
  reportId: string
  expenseId: string
}

export interface UpdateExpenseParams extends SapConcurBaseParams {
  reportId: string
  expenseId: string
  body: Record<string, unknown> | string
}

export interface DeleteExpenseParams extends SapConcurBaseParams {
  reportId: string
  expenseId: string
}

export interface ListAllocationsParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'MANAGER' | 'PROXY'
  reportId: string
  expenseId: string
}

export interface GetAllocationParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'MANAGER' | 'PROXY'
  reportId: string
  allocationId: string
}

export interface UpdateAllocationParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  allocationId: string
  body: Record<string, unknown> | string
}

export interface ListAttendeeAssociationsParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  expenseId: string
}

export interface AssociateAttendeesParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  expenseId: string
  body: Record<string, unknown> | string
}

export interface RemoveAllAttendeesParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  expenseId: string
}

export interface ListReportCommentsParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  includeAllComments?: boolean
}

export interface CreateReportCommentParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'PROXY'
  reportId: string
  comment: string
}

export interface ListExceptionsParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER' | 'MANAGER' | 'PROXY'
  reportId: string
}

export interface CreateQuickExpenseParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER'
  body: Record<string, unknown> | string
}

export interface ListReceiptsParams extends SapConcurBaseParams {
  userId: string
}

export interface GetReceiptParams extends SapConcurBaseParams {
  receiptId: string
}

export interface GetReceiptStatusParams extends SapConcurBaseParams {
  receiptId: string
}

export interface ListTravelRequestsParams extends SapConcurBaseParams {
  view?: string
  limit?: number
  start?: number
  userId?: string
  approvedBefore?: string
  approvedAfter?: string
  modifiedBefore?: string
  modifiedAfter?: string
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}

export interface GetTravelRequestParams extends SapConcurBaseParams {
  requestUuid: string
  userId?: string
}

export interface CreateTravelRequestParams extends SapConcurBaseParams {
  userId?: string
  body: Record<string, unknown> | string
}

export interface UpdateTravelRequestParams extends SapConcurBaseParams {
  requestUuid: string
  body: Record<string, unknown> | string
}

export interface DeleteTravelRequestParams extends SapConcurBaseParams {
  requestUuid: string
  userId?: string
}

export interface MoveTravelRequestParams extends SapConcurBaseParams {
  requestUuid: string
  action: string
  userId?: string
  body?: Record<string, unknown> | string
}

export interface ListTravelRequestCommentsParams extends SapConcurBaseParams {
  requestUuid: string
}

export interface GetRequestCashAdvanceParams extends SapConcurBaseParams {
  cashAdvanceUuid: string
}

export interface CreateExpectedExpenseParams extends SapConcurBaseParams {
  requestUuid: string
  userId?: string
  body: Record<string, unknown> | string
}

export interface ListExpectedExpensesParams extends SapConcurBaseParams {
  requestUuid: string
  userId?: string
}

export interface GetExpectedExpenseParams extends SapConcurBaseParams {
  expenseUuid: string
  userId?: string
}

export interface UpdateExpectedExpenseParams extends SapConcurBaseParams {
  expenseUuid: string
  userId?: string
  body: Record<string, unknown> | string
}

export interface DeleteExpectedExpenseParams extends SapConcurBaseParams {
  expenseUuid: string
  userId?: string
}

export interface GetCashAdvanceParams extends SapConcurBaseParams {
  cashAdvanceId: string
}

export interface CreateCashAdvanceParams extends SapConcurBaseParams {
  body: Record<string, unknown> | string
}

export interface IssueCashAdvanceParams extends SapConcurBaseParams {
  cashAdvanceId: string
  body?: Record<string, unknown> | string
}

export interface ListItinerariesParams extends SapConcurBaseParams {
  startDate?: string
  endDate?: string
  bookingType?: string
  useridType?: string
  useridValue?: string
  itemsPerPage?: number
  page?: number
  includeMetadata?: boolean
  includeCanceledTrips?: boolean
  createdAfterDate?: string
  createdBeforeDate?: string
  lastModifiedDate?: string
}

export interface GetItineraryParams extends SapConcurBaseParams {
  tripId: string
  useridType?: string
  useridValue?: string
  systemFormat?: string
}

export interface ListUsersParams extends SapConcurBaseParams {
  count?: number
  cursor?: string
  attributes?: string
  excludedAttributes?: string
}

export interface SearchUsersParams extends SapConcurBaseParams {
  body: Record<string, unknown> | string
}

export interface GetUserParams extends SapConcurBaseParams {
  userUuid: string
  attributes?: string
  excludedAttributes?: string
}

export interface CreateUserParams extends SapConcurBaseParams {
  body: Record<string, unknown> | string
}

export interface UpdateUserParams extends SapConcurBaseParams {
  userUuid: string
  body: Record<string, unknown> | string
}

export interface DeleteUserParams extends SapConcurBaseParams {
  userUuid: string
}

export interface GetTravelProfileParams extends SapConcurBaseParams {
  loginId?: string
  userId?: string
  useridType?: 'login' | 'xmlsyncid' | 'uuid'
  useridValue?: string
}

export interface ListTravelProfilesSummaryParams extends SapConcurBaseParams {
  lastModifiedDate: string
  page?: number
  itemsPerPage?: number
  travelConfigs?: string
}

export interface SearchLocationsParams extends SapConcurBaseParams {
  searchText?: string
  locCode?: string
  locationNameId?: string
  locationNameKey?: number
  countryCode?: string
  subdivisionCode?: string
  adminRegionId?: string
}

export interface CreateListItemParams extends SapConcurBaseParams {
  body: Record<string, unknown> | string
}

export interface UpdateListItemParams extends SapConcurBaseParams {
  itemId: string
  body: Record<string, unknown> | string
}

export interface DeleteListItemParams extends SapConcurBaseParams {
  itemId: string
}

export interface UserFileLike {
  id?: string
  key?: string
  path?: string
  url?: string
  name: string
  size: number
  type?: string
  [key: string]: unknown
}

export interface UploadReceiptImageParams extends SapConcurBaseParams {
  userId: string
  receipt: UserFileLike
  forwardId?: string
}

export interface CreateQuickExpenseWithImageParams extends SapConcurBaseParams {
  userId: string
  contextType: 'TRAVELER'
  receipt: UserFileLike
  body: Record<string, unknown> | string
}

export interface ListInvoicesParams extends SapConcurBaseParams {
  limit?: number
  offset?: number
  modifiedAfter?: string
}

export interface GetInvoiceParams extends SapConcurBaseParams {
  invoiceId: string
}

export interface ListPurchaseOrdersParams extends SapConcurBaseParams {
  limit?: number
  offset?: number
}

export interface GetPurchaseOrderParams extends SapConcurBaseParams {
  purchaseOrderId: string
}

export interface ListVendorsParams extends SapConcurBaseParams {
  limit?: number
  offset?: number
  vendorCode?: string
}

export interface ListPurchaseRequestsParams extends SapConcurBaseParams {
  limit?: number
  offset?: number
  modifiedAfter?: string
}

export interface GetPurchaseRequestParams extends SapConcurBaseParams {
  purchaseRequestId: string
}

export interface CreatePurchaseRequestParams extends SapConcurBaseParams {
  body: Record<string, unknown> | string
}

export interface UpdatePurchaseRequestParams extends SapConcurBaseParams {
  purchaseRequestId: string
  body: Record<string, unknown> | string
}

export interface ListListsParams extends SapConcurBaseParams {
  page?: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  value?: string
  categoryType?: string
  isDeleted?: boolean
  levelCount?: number
}

export interface GetListParams extends SapConcurBaseParams {
  listId: string
}

export interface ListListItemsParams extends SapConcurBaseParams {
  listId: string
  page?: number
  sortBy?: 'value' | 'shortCode'
  sortDirection?: 'asc' | 'desc'
  hasChildren?: boolean
  isDeleted?: boolean
  shortCode?: string
  value?: string
  shortCodeOrValue?: string
}

export interface GetListItemParams extends SapConcurBaseParams {
  itemId: string
}

export interface ListBudgetsParams extends SapConcurBaseParams {
  adminView?: boolean
  offset?: number
  responseSchema?: 'COMPACT'
}

export interface GetBudgetParams extends SapConcurBaseParams {
  budgetId: string
}

export interface ListBudgetItemsParams extends SapConcurBaseParams {
  budgetId: string
  limit?: number
  offset?: number
}

export type ListBudgetCategoriesParams = SapConcurBaseParams

export interface ListCardTransactionsParams extends SapConcurBaseParams {
  limit?: number
  offset?: number
  cardAccountId?: string
  user?: string
  modifiedAfter?: string
}

export interface GetCardTransactionParams extends SapConcurBaseParams {
  cardTransactionId: string
}

export interface UploadExchangeRatesParams extends SapConcurBaseParams {
  body: Record<string, unknown> | string
}

export interface ListLocalitiesParams extends SapConcurBaseParams {
  limit?: number
  offset?: number
  countryCode?: string
}
