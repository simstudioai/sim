export interface SailPointCredentials {
  clientId: string
  clientSecret: string
  tenant: string
}

interface SailPointPaginationParams {
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

type SailPointSearchIndex =
  | 'accessprofiles'
  | 'accountactivities'
  | 'entitlements'
  | 'events'
  | 'identities'
  | 'roles'
  | '*'

interface SailPointSearchQuery {
  query?: string
  fields?: string
  timeZone?: string
  innerHit?: Record<string, unknown>
}

interface SailPointTextQuery {
  terms: string[]
  fields: string[]
  matchAny?: boolean
  contains?: boolean
}

interface SailPointTypeAheadQuery {
  query: string
  field: string
  nestedType?: string
  maxExpansions?: number
  size?: number
  sort?: string
  sortByValue?: boolean
}

interface SailPointQueryResultFilter {
  includes?: string[]
  excludes?: string[]
}

interface SailPointSearchFilter {
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

type SailPointAccessRequestType = 'GRANT_ACCESS' | 'REVOKE_ACCESS' | 'MODIFY_ACCESS'
type SailPointRequestedItemType = 'ACCESS_PROFILE' | 'ROLE' | 'ENTITLEMENT'

interface SailPointRequestedItem {
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

type SailPointNestedRequestedItem = Omit<SailPointRequestedItem, 'assignmentId'> & {
  accountSelection?: SailPointSourceItemRef[] | null
}

interface SailPointAccountItemRef {
  accountUuid?: string | null
  nativeIdentity?: string
}

export interface SailPointSourceItemRef {
  sourceId?: string | null
  accounts?: SailPointAccountItemRef[] | null
}

interface SailPointRequestedForWithItems {
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

interface SailPointReviewRecommendation {
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
