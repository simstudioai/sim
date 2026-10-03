import type { ToolResponse } from '@/tools/types'

export interface SailPointCredentials {
  clientId: string
  clientSecret: string
  tenant: string
}

export interface SailPointPaginationParams {
  limit?: number
  offset?: number
  count?: boolean
}

export interface SailPointListParams extends SailPointCredentials, SailPointPaginationParams {
  filters?: string
  sorters?: string
}

export interface SailPointGetByIdParams extends SailPointCredentials {
  id: string
}

export interface SailPointListOutput<T = Record<string, unknown>> {
  items: T[]
  count: number
  totalCount: number | null
}

export interface SailPointListResponse<T = Record<string, unknown>> extends ToolResponse {
  output: SailPointListOutput<T>
}

export interface SailPointResourceResponse<
  T extends Record<string, unknown> = Record<string, unknown>,
> extends ToolResponse {
  output: T
}

export interface SailPointAcceptedResponse extends ToolResponse {
  output: { accepted: boolean; status: number }
}

export interface SailPointListIdentitiesParams extends SailPointListParams {
  defaultFilter?: 'CORRELATED_ONLY' | 'NONE'
}

export interface SailPointListAccountsParams extends SailPointListParams {
  detailLevel?: 'SLIM' | 'FULL'
}

export interface SailPointListEntitlementsParams extends SailPointListParams {
  segmentedForIdentity?: string
  forSegmentIds?: string
  includeUnsegmented?: boolean
  searchAfter?: string
}

export interface SailPointSegmentedListParams extends SailPointListParams {
  forSubadmin?: string
  forSegmentIds?: string
  includeUnsegmented?: boolean
}

export interface SailPointGetChildEntitlementsParams extends SailPointListParams {
  id: string
}

export interface SailPointListSourcesParams extends SailPointListParams {
  forSubadmin?: string
  includeIDNSource?: boolean
}

export interface SailPointListAccountActivitiesParams extends SailPointListParams {
  requestedFor?: string
  requestedBy?: string
  regardingIdentity?: string
}

export interface SailPointListCampaignsParams extends SailPointListParams {
  detail?: 'SLIM' | 'FULL'
}

export interface SailPointGetCampaignParams extends SailPointGetByIdParams {
  detail?: 'SLIM' | 'FULL'
}

export interface SailPointListCertificationsParams extends SailPointListParams {
  reviewerIdentity?: string
}

export interface SailPointListReviewItemsParams extends SailPointListParams {
  id: string
  entitlements?: string
  accessProfiles?: string
  roles?: string
}

export type SailPointSearchIndex =
  | 'accessprofiles'
  | 'accountactivities'
  | 'entitlements'
  | 'events'
  | 'identities'
  | 'roles'
  | '*'

export interface SailPointSearchQuery {
  query?: string
  fields?: string
  timeZone?: string
  innerHit?: Record<string, unknown>
}

export interface SailPointTextQuery {
  terms: string[]
  fields: string[]
  matchAny?: boolean
  contains?: boolean
}

export interface SailPointTypeAheadQuery {
  query: string
  field: string
  nestedType?: string
  maxExpansions?: number
  size?: number
  sort?: string
  sortByValue?: boolean
}

export interface SailPointQueryResultFilter {
  includes?: string[]
  excludes?: string[]
}

export interface SailPointSearchFilter {
  type?: string
  range?: Record<string, unknown>
  terms?: string[]
  exclude?: boolean
}

export interface SailPointSearchBodyParams extends SailPointCredentials {
  indices?: SailPointSearchIndex[] | string
  queryType?: 'DSL' | 'SAILPOINT' | 'TEXT' | 'TYPEAHEAD'
  queryVersion?: string
  query?: SailPointSearchQuery | string
  queryDsl?: Record<string, unknown> | string
  textQuery?: SailPointTextQuery | string
  typeAheadQuery?: SailPointTypeAheadQuery | string
  includeNested?: boolean
  queryResultFilter?: SailPointQueryResultFilter | string
  aggregationType?: 'DSL' | 'SAILPOINT'
  aggregationsVersion?: string
  aggregationsDsl?: Record<string, unknown> | string
  aggregations?: Record<string, unknown> | string
  sort?: string[] | string
  searchAfter?: string[] | string
  filters?: Record<string, SailPointSearchFilter> | string
}

export interface SailPointSearchParams
  extends SailPointSearchBodyParams,
    SailPointPaginationParams {}

export interface SailPointSearchCountParams extends SailPointSearchBodyParams {}

export interface SailPointSearchAggregateParams
  extends SailPointSearchBodyParams,
    SailPointPaginationParams {}

export interface SailPointSearchResponse extends ToolResponse {
  output: { results: Record<string, unknown>[]; count: number; totalCount: number | null }
}

export interface SailPointSearchCountResponse extends ToolResponse {
  output: { total: number }
}

export interface SailPointSearchAggregateResponse extends ToolResponse {
  output: {
    aggregations: Record<string, unknown>
    hits: Record<string, unknown>[]
    totalCount: number | null
  }
}

export type SailPointAccessRequestType = 'GRANT_ACCESS' | 'REVOKE_ACCESS' | 'MODIFY_ACCESS'
export type SailPointRequestedItemType = 'ACCESS_PROFILE' | 'ROLE' | 'ENTITLEMENT'

export interface SailPointRequestedItem {
  type: SailPointRequestedItemType
  id: string
  comment?: string
  clientMetadata?: Record<string, string>
  startDate?: string
  removeDate?: string
  assignmentId?: string | null
  nativeIdentity?: string | null
  formInstanceId?: string | null
}

export type SailPointNestedRequestedItem = Omit<SailPointRequestedItem, 'assignmentId'> & {
  accountSelection?: SailPointSourceItemRef[] | null
}

export interface SailPointAccountItemRef {
  accountUuid?: string | null
  nativeIdentity?: string
}

export interface SailPointSourceItemRef {
  sourceId?: string | null
  accounts?: SailPointAccountItemRef[] | null
}

export interface SailPointRequestedForWithItems {
  identityId: string
  identityType?: 'HUMAN' | 'MACHINE'
  requestedItems: SailPointNestedRequestedItem[]
}

export interface SailPointRequestAccessParams extends SailPointCredentials {
  requestType?: SailPointAccessRequestType
  requestedFor?: string[] | string
  requestedItems?: SailPointRequestedItem[] | string
  requestedForWithRequestedItems?: SailPointRequestedForWithItems[] | string
  clientMetadata?: Record<string, string> | string
}

export interface SailPointAccessRequestTracking {
  requestedFor?: string
  requestedItemsDetails?: Array<{ type?: SailPointRequestedItemType; id?: string }>
  attributesHash?: number
  accessRequestIds?: string[]
}

export interface SailPointAccessRequestResponse extends ToolResponse {
  output: {
    accepted: boolean
    status: number
    newRequests: SailPointAccessRequestTracking[]
    existingRequests: SailPointAccessRequestTracking[]
  }
}

export interface SailPointCancelAccessRequestParams extends SailPointCredentials {
  accountActivityId: string
  comment: string
}

export interface SailPointAccessRequestStatusParams extends SailPointListParams {
  requestedFor?: string
  requestedBy?: string
  regardingIdentity?: string
  assignedTo?: string
  requestState?: 'EXECUTING'
}

export interface SailPointLoadAccountsParams extends SailPointCredentials {
  sourceId: string
  file?: unknown
  disableOptimization?: boolean
}

export interface SailPointLoadEntitlementsParams extends SailPointCredentials {
  sourceId: string
  file?: unknown
}

export interface SailPointTask {
  id?: string
  type?: string
  name?: string
  uniqueName?: string
  description?: string
  launcher?: string
  created?: string
  launched?: string | null
  completed?: string | null
  completionStatus?: string | null
  parentName?: string | null
  messages?: Record<string, unknown>[]
  progress?: string | null
  percentComplete?: number
  attributes?: Record<string, unknown>
  returns?: Record<string, unknown>[]
}

export interface SailPointTaskResponse extends ToolResponse {
  output: { task: SailPointTask }
}

export interface SailPointLoadAccountsResponse extends ToolResponse {
  output: { success: boolean; task: SailPointTask }
}

export interface SailPointLoadEntitlementsResponse extends ToolResponse {
  output: { task: SailPointTask }
}

export interface SailPointReviewRecommendation {
  recommendation?: string | null
  reasons?: string[]
  timestamp?: string
}

export interface SailPointCertificationDecision {
  id: string
  decision: 'APPROVE' | 'REVOKE'
  bulk: boolean
  proposedEndDate?: string
  recommendation?: SailPointReviewRecommendation | null
  comments?: string
}

export interface SailPointDecideCertificationReviewItemsParams extends SailPointGetByIdParams {
  decisions: SailPointCertificationDecision[] | string
}

export interface SailPointListPendingApprovalsParams extends SailPointListParams {
  ownerId?: string
}

export interface SailPointApprovalDecisionParams extends SailPointCredentials {
  approvalId: string
  comment?: string
}

export interface SailPointRejectApprovalParams extends SailPointApprovalDecisionParams {
  comment: string
}
