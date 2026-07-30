import type { ToolResponse } from '@/tools/types'

export type SailPointApiVersion = 'v2025' | 'v2024' | 'v3'

/** Credentials shared by every SailPoint tool (a service-identity PAT + tenant + version). */
export interface SailPointCredentials {
  clientId: string
  clientSecret: string
  tenant: string
  apiVersion?: SailPointApiVersion
}

/** Envelope wrapping a paginated list of raw SailPoint documents plus the empty-result diagnostic. */
export interface SailPointListOutput {
  items: unknown[]
  count: number
  totalCount: number | null
  complete: boolean
  warnings: string[]
}

export interface SailPointListResponse extends ToolResponse {
  output: SailPointListOutput
}

/** Search returns raw documents under `results` (index-dependent shape). */
export interface SailPointSearchOutput {
  results: unknown[]
  count: number
  totalCount: number | null
  complete: boolean
  warnings: string[]
}

export interface SailPointSearchResponse extends ToolResponse {
  output: SailPointSearchOutput
}

export interface SailPointCountResponse extends ToolResponse {
  output: { total: number }
}

export interface SailPointItemResponse extends ToolResponse {
  output: { item: unknown }
}

/** Access-request create/cancel return 202 with an empty body. */
export interface SailPointWriteResponse extends ToolResponse {
  output: { accepted: boolean; status: number }
}

/** load-accounts / load-entitlements return a task object (LoadAccountsTask / LoadEntitlementTask). */
export interface SailPointTaskResponse extends ToolResponse {
  output: { task: unknown }
}

export interface SailPointSearchParams extends SailPointCredentials {
  indices?: string[] | string
  query?: string
  sort?: string[] | string
  searchAfter?: string[] | string
  includeNested?: boolean
  limit?: number
  offset?: number
  count?: boolean
}

export interface SailPointSearchCountParams extends SailPointCredentials {
  indices?: string[] | string
  query?: string
}

export interface SailPointSearchAggregateParams extends SailPointCredentials {
  indices?: string[] | string
  query?: string
  limit?: number
  offset?: number
}

export interface SailPointListParams extends SailPointCredentials {
  filters?: string
  sorters?: string
  limit?: number
  offset?: number
  count?: boolean
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
  accountId?: string
  segmentedForIdentity?: string
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

export interface SailPointGetCampaignParams extends SailPointCredentials {
  id: string
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

export interface SailPointRequestedItem {
  type: 'ACCESS_PROFILE' | 'ROLE' | 'ENTITLEMENT'
  id: string
  comment?: string
  removeDate?: string
  startDate?: string
  assignmentId?: string
  nativeIdentity?: string
  clientMetadata?: Record<string, string>
}

export interface SailPointRequestAccessParams extends SailPointCredentials {
  requestedFor: string[] | string
  requestedItems: SailPointRequestedItem[] | string
  requestType?: 'GRANT_ACCESS' | 'REVOKE_ACCESS' | 'MODIFY_ACCESS'
  clientMetadata?: Record<string, string> | string
}

export interface SailPointCancelAccessRequestParams extends SailPointCredentials {
  accountActivityId: string
  comment: string
}

export interface SailPointAccessRequestStatusParams extends SailPointCredentials {
  requestedFor?: string
  requestedBy?: string
  regardingIdentity?: string
  assignedTo?: string
  requestState?: 'EXECUTING'
  filters?: string
  sorters?: string
  limit?: number
  offset?: number
  count?: boolean
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
