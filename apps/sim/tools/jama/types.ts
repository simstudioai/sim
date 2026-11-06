import type { ToolResponse } from '@/tools/types'

interface JamaAuthParams {
  accessToken: string
  instanceUrl: string
}

interface JamaPaginationParams {
  startAt?: number
  maxResults?: number
}

export interface JamaPageInfo {
  startIndex: number
  resultCount: number
  totalResults: number
}

export interface JamaItem {
  id: number
  documentKey: string
  globalId: string | null
  itemType: number
  project: number
  createdDate: string | null
  modifiedDate: string | null
  lastActivityDate: string | null
  createdBy: number | null
  modifiedBy: number | null
  fields: Record<string, unknown>
  version: number | null
}

export interface JamaProject {
  id: number
  name: string
  projectKey: string | null
  description: string | null
  isFolder: boolean | null
  createdDate: string | null
  modifiedDate: string | null
}

export interface JamaItemType {
  id: number
  typeKey: string
  display: string
  displayPlural: string | null
  description: string | null
  category: string | null
  fields: JamaItemTypeField[]
}

export interface JamaItemTypeField {
  id: number
  name: string
  label: string
  fieldType: string
  readOnly: boolean
  required: boolean
  pickList: number | null
}

export interface JamaRelationship {
  id: number
  fromItem: number
  toItem: number
  relationshipType: number
  suspect: boolean
}

export interface JamaRelationshipType {
  id: number
  name: string
  description: string | null
}

export interface JamaComment {
  id: number
  inReplyTo: number | null
  createdDate: string | null
  createdBy: number | null
  status: string | null
  text: string
  item: number | null
  project: number | null
}

export interface JamaVersion {
  item: number
  versionNumber: number
  changeDetails: string | null
  comment: string | null
  createdDate: string | null
  createdBy: number | null
  userName: string | null
}

export interface JamaFilter {
  id: number
  name: string
  author: number | null
  projectScope: string | null
  specifiedProject: number | null
  public: boolean
}

export interface JamaBaseline {
  id: number
  baselineKey: string | null
  name: string
  description: string | null
  createdDate: string | null
  createdBy: number | null
  project: number
  sourceName: string | null
  signed: boolean
}

export interface JamaRelease {
  id: number
  name: string
  description: string | null
  project: number
  releaseDate: string | null
  active: boolean
  archived: boolean
  itemCount: number
}

export interface JamaTag {
  id: number
  name: string
  project: number
}

export interface JamaPickList {
  id: number
  name: string
  description: string | null
}

export interface JamaPickListOption {
  id: number
  name: string
  description: string | null
  value: string | null
  active: boolean
  pickList: number
}

export interface JamaUser {
  id: number
  username: string
  firstName: string
  lastName: string
  email: string
  active: boolean
  licenseType: string
}

export interface JamaListProjectsParams extends JamaAuthParams, JamaPaginationParams {}

export interface JamaListProjectsResponse extends ToolResponse {
  output: { projects: JamaProject[]; pageInfo: JamaPageInfo }
}

export interface JamaGetProjectParams extends JamaAuthParams {
  projectId: string
}

export interface JamaGetProjectResponse extends ToolResponse {
  output: { project: JamaProject }
}

export interface JamaListItemTypesParams extends JamaAuthParams, JamaPaginationParams {
  projectId?: string
}

export interface JamaListItemTypesResponse extends ToolResponse {
  output: { itemTypes: JamaItemType[]; pageInfo: JamaPageInfo }
}

export interface JamaGetItemTypeParams extends JamaAuthParams {
  itemTypeId: string
}

export interface JamaGetItemTypeResponse extends ToolResponse {
  output: { itemType: JamaItemType }
}

export interface JamaListItemsParams extends JamaAuthParams, JamaPaginationParams {
  projectId: string
  rootOnly?: boolean
}

export interface JamaListItemsResponse extends ToolResponse {
  output: { items: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaSearchItemsParams extends JamaAuthParams, JamaPaginationParams {
  query: string
  projectId?: string
  itemTypeId?: string
  documentKey?: string
  modifiedSince?: string
  sortBy?: string
}

export interface JamaSearchItemsResponse extends ToolResponse {
  output: { items: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaGetItemParams extends JamaAuthParams {
  itemId: string
}

export interface JamaGetItemResponse extends ToolResponse {
  output: { item: JamaItem }
}

export interface JamaCreateItemParams extends JamaAuthParams {
  projectId: string
  itemTypeId: string
  fields: unknown
  parentItemId?: string
  childItemTypeId?: string
}

export interface JamaCreateItemResponse extends ToolResponse {
  output: { id: number; location: string | null }
}

export interface JamaUpdateItemParams extends JamaAuthParams {
  itemId: string
  patch: unknown
}

export interface JamaUpdateItemResponse extends ToolResponse {
  output: { status: number }
}

export interface JamaDeleteItemParams extends JamaAuthParams {
  itemId: string
}

export interface JamaDeleteItemResponse extends ToolResponse {
  output: { status: number }
}

export interface JamaListItemChildrenParams extends JamaAuthParams, JamaPaginationParams {
  itemId: string
}

export interface JamaListItemChildrenResponse extends ToolResponse {
  output: { items: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaListUpstreamItemsParams extends JamaAuthParams, JamaPaginationParams {
  itemId: string
}

export interface JamaListUpstreamItemsResponse extends ToolResponse {
  output: { items: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaListDownstreamItemsParams extends JamaAuthParams, JamaPaginationParams {
  itemId: string
}

export interface JamaListDownstreamItemsResponse extends ToolResponse {
  output: { items: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaListRelationshipsParams extends JamaAuthParams, JamaPaginationParams {
  projectId: string
}

export interface JamaListRelationshipsResponse extends ToolResponse {
  output: { relationships: JamaRelationship[]; pageInfo: JamaPageInfo }
}

export interface JamaGetRelationshipParams extends JamaAuthParams {
  relationshipId: string
}

export interface JamaGetRelationshipResponse extends ToolResponse {
  output: { relationship: JamaRelationship }
}

export interface JamaCreateRelationshipParams extends JamaAuthParams {
  fromItemId: string
  toItemId: string
  relationshipTypeId?: string
}

export interface JamaCreateRelationshipResponse extends ToolResponse {
  output: { id: number; location: string | null }
}

export interface JamaDeleteRelationshipParams extends JamaAuthParams {
  relationshipId: string
}

export interface JamaDeleteRelationshipResponse extends ToolResponse {
  output: { status: number }
}

export interface JamaListRelationshipTypesParams extends JamaAuthParams, JamaPaginationParams {}

export interface JamaListRelationshipTypesResponse extends ToolResponse {
  output: { relationshipTypes: JamaRelationshipType[]; pageInfo: JamaPageInfo }
}

export interface JamaListItemCommentsParams extends JamaAuthParams, JamaPaginationParams {
  itemId: string
}

export interface JamaListItemCommentsResponse extends ToolResponse {
  output: { comments: JamaComment[]; pageInfo: JamaPageInfo }
}

export interface JamaCreateCommentParams extends JamaAuthParams {
  itemId: string
  text: string
  inReplyTo?: string
}

export interface JamaCreateCommentResponse extends ToolResponse {
  output: { id: number; location: string | null }
}

export interface JamaListItemVersionsParams extends JamaAuthParams, JamaPaginationParams {
  itemId: string
}

export interface JamaListItemVersionsResponse extends ToolResponse {
  output: { versions: JamaVersion[]; pageInfo: JamaPageInfo }
}

export interface JamaGetItemVersionParams extends JamaAuthParams {
  itemId: string
  versionNumber: string
}

export interface JamaGetItemVersionResponse extends ToolResponse {
  output: { item: JamaItem }
}

export interface JamaListFiltersParams extends JamaAuthParams, JamaPaginationParams {
  projectId?: string
}

export interface JamaListFiltersResponse extends ToolResponse {
  output: { filters: JamaFilter[]; pageInfo: JamaPageInfo }
}

export interface JamaGetFilterParams extends JamaAuthParams {
  filterId: string
}

export interface JamaGetFilterResponse extends ToolResponse {
  output: { filter: JamaFilter }
}

export interface JamaListFilterResultsParams extends JamaAuthParams, JamaPaginationParams {
  projectId?: string
  filterId: string
}

export interface JamaListFilterResultsResponse extends ToolResponse {
  output: { items: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaListBaselinesParams extends JamaAuthParams, JamaPaginationParams {
  projectId: string
}

export interface JamaListBaselinesResponse extends ToolResponse {
  output: { baselines: JamaBaseline[]; pageInfo: JamaPageInfo }
}

export interface JamaGetBaselineParams extends JamaAuthParams {
  baselineId: string
}

export interface JamaGetBaselineResponse extends ToolResponse {
  output: { baseline: JamaBaseline }
}

export interface JamaListBaselineItemsParams extends JamaAuthParams, JamaPaginationParams {
  baselineId: string
}

export interface JamaListBaselineItemsResponse extends ToolResponse {
  output: { items: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaListTestPlansParams extends JamaAuthParams, JamaPaginationParams {
  projectId: string
}

export interface JamaListTestPlansResponse extends ToolResponse {
  output: { testPlans: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaGetTestPlanParams extends JamaAuthParams {
  testPlanId: string
}

export interface JamaGetTestPlanResponse extends ToolResponse {
  output: { testPlan: JamaItem }
}

export interface JamaListTestCyclesParams extends JamaAuthParams, JamaPaginationParams {
  testPlanId: string
}

export interface JamaListTestCyclesResponse extends ToolResponse {
  output: { testCycles: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaGetTestCycleParams extends JamaAuthParams {
  testCycleId: string
}

export interface JamaGetTestCycleResponse extends ToolResponse {
  output: { testCycle: JamaItem }
}

export interface JamaListTestRunsParams extends JamaAuthParams, JamaPaginationParams {
  testCycleId: string
}

export interface JamaListTestRunsResponse extends ToolResponse {
  output: { testRuns: JamaItem[]; pageInfo: JamaPageInfo }
}

export interface JamaGetTestRunParams extends JamaAuthParams {
  testRunId: string
}

export interface JamaGetTestRunResponse extends ToolResponse {
  output: { testRun: JamaItem }
}

export interface JamaUpdateTestRunParams extends JamaAuthParams {
  testRunId: string
  fields: unknown
}

export interface JamaUpdateTestRunResponse extends ToolResponse {
  output: { status: number }
}

export interface JamaListReleasesParams extends JamaAuthParams, JamaPaginationParams {
  projectId: string
}

export interface JamaListReleasesResponse extends ToolResponse {
  output: { releases: JamaRelease[]; pageInfo: JamaPageInfo }
}

export interface JamaListTagsParams extends JamaAuthParams, JamaPaginationParams {
  projectId: string
}

export interface JamaListTagsResponse extends ToolResponse {
  output: { tags: JamaTag[]; pageInfo: JamaPageInfo }
}

export interface JamaListPickListsParams extends JamaAuthParams, JamaPaginationParams {}

export interface JamaListPickListsResponse extends ToolResponse {
  output: { pickLists: JamaPickList[]; pageInfo: JamaPageInfo }
}

export interface JamaListPickListOptionsParams extends JamaAuthParams, JamaPaginationParams {
  pickListId: string
}

export interface JamaListPickListOptionsResponse extends ToolResponse {
  output: { options: JamaPickListOption[]; pageInfo: JamaPageInfo }
}

export interface JamaGetCurrentUserParams extends JamaAuthParams {}

export interface JamaGetCurrentUserResponse extends ToolResponse {
  output: { user: JamaUser }
}
