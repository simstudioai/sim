import type { UserFile } from '@/executor/types'
import type { ToolFileData, ToolResponse } from '@/tools/types'

/** Connection parameters shared by every Plane tool. */
export interface PlaneBaseParams {
  apiKey: string
  workspaceSlug: string
  baseUrl?: string
}

interface PlaneProjectScopedParams extends PlaneBaseParams {
  projectId: string
}

interface PlaneWorkItemScopedParams extends PlaneProjectScopedParams {
  workItemId: string
}

interface PlanePaginationParams {
  perPage?: number
  cursor?: string
}

type PlanePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export interface PlaneWorkItem {
  id: string
  name: string
  descriptionHtml: string | null
  priority: string | null
  stateId: string | null
  parentId: string | null
  estimatePointId: string | null
  typeId: string | null
  sequenceId: number | null
  sortOrder: number | null
  startDate: string | null
  targetDate: string | null
  completedAt: string | null
  archivedAt: string | null
  isDraft: boolean | null
  assigneeIds: string[]
  labelIds: string[]
  projectId: string | null
  workspaceId: string | null
  externalSource: string | null
  externalId: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface PlaneSearchResult {
  id: string
  name: string
  sequenceId: number | null
  projectIdentifier: string | null
  identifier: string | null
  projectId: string | null
  workspaceSlug: string | null
}

export interface PlaneComment {
  id: string
  commentHtml: string | null
  access: string | null
  actorId: string | null
  workItemId: string | null
  projectId: string | null
  parentId: string | null
  isMember: boolean | null
  externalSource: string | null
  externalId: string | null
  editedAt: string | null
  createdById: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface PlaneLink {
  id: string
  title: string | null
  url: string | null
  workItemId: string | null
  projectId: string | null
  createdById: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface PlaneAttachment {
  id: string
  name: string | null
  type: string | null
  size: number | null
  workItemId: string | null
  projectId: string | null
  isUploaded: boolean | null
  externalSource: string | null
  externalId: string | null
  createdById: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface PlaneProject {
  id: string
  name: string
  identifier: string | null
  description: string | null
  network: number | null
  emoji: string | null
  projectLeadId: string | null
  defaultAssigneeId: string | null
  defaultStateId: string | null
  timezone: string | null
  totalMembers: number | null
  totalCycles: number | null
  totalModules: number | null
  isMember: boolean | null
  memberRole: number | null
  cycleView: boolean | null
  moduleView: boolean | null
  issueViewsView: boolean | null
  pageView: boolean | null
  intakeView: boolean | null
  archivedAt: string | null
  workspaceId: string | null
  externalSource: string | null
  externalId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface PlaneState {
  id: string
  name: string
  description: string | null
  color: string | null
  group: string | null
  sequence: number | null
  isDefault: boolean | null
  isTriage: boolean | null
  projectId: string | null
  externalSource: string | null
  externalId: string | null
}

export interface PlaneLabel {
  id: string
  name: string
  description: string | null
  color: string | null
  parentId: string | null
  sortOrder: number | null
  projectId: string | null
  externalSource: string | null
  externalId: string | null
}

export interface PlaneUser {
  id: string
  firstName: string | null
  lastName: string | null
  displayName: string | null
  email: string | null
  avatar: string | null
  avatarUrl: string | null
}

export interface PlaneWorkspaceMember extends PlaneUser {
  role: number | null
}

export interface PlaneCycle {
  id: string
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
  ownedById: string | null
  timezone: string | null
  archivedAt: string | null
  totalIssues: number | null
  completedIssues: number | null
  startedIssues: number | null
  unstartedIssues: number | null
  backlogIssues: number | null
  cancelledIssues: number | null
  projectId: string | null
  externalSource: string | null
  externalId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface PlaneModule {
  id: string
  name: string
  description: string | null
  status: string | null
  startDate: string | null
  targetDate: string | null
  leadId: string | null
  memberIds: string[]
  archivedAt: string | null
  totalIssues: number | null
  completedIssues: number | null
  startedIssues: number | null
  unstartedIssues: number | null
  backlogIssues: number | null
  cancelledIssues: number | null
  projectId: string | null
  externalSource: string | null
  externalId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface PlaneActivity {
  id: string
  verb: string | null
  field: string | null
  oldValue: string | null
  newValue: string | null
  comment: string | null
  actorId: string | null
  workItemId: string | null
  commentId: string | null
  oldIdentifier: string | null
  newIdentifier: string | null
  createdAt: string | null
}

export interface PlanePagination {
  nextCursor: string | null
  prevCursor: string | null
  nextPageResults: boolean
  prevPageResults: boolean
  count: number | null
  totalPages: number | null
  totalResults: number | null
}

export interface PlaneCreateWorkItemParams extends PlaneProjectScopedParams {
  name: string
  description?: string
  stateId?: string
  priority?: PlanePriority
  assigneeIds?: string | string[]
  labelIds?: string | string[]
  parentId?: string
  startDate?: string
  targetDate?: string
  estimatePointId?: string
  typeId?: string
  externalId?: string
  externalSource?: string
}

export interface PlaneUpdateWorkItemParams extends PlaneWorkItemScopedParams {
  name?: string
  description?: string
  stateId?: string
  priority?: PlanePriority
  assigneeIds?: string | string[]
  labelIds?: string | string[]
  parentId?: string
  startDate?: string
  targetDate?: string
  estimatePointId?: string
  typeId?: string
}

export type PlaneGetWorkItemParams = PlaneWorkItemScopedParams

export interface PlaneGetWorkItemByIdentifierParams extends PlaneBaseParams {
  identifier: string
}

export interface PlaneListWorkItemsParams extends PlaneProjectScopedParams, PlanePaginationParams {
  orderBy?: string
}

export type PlaneDeleteWorkItemParams = PlaneWorkItemScopedParams

export interface PlaneSearchWorkItemsParams extends PlaneBaseParams {
  query: string
  projectId?: string
  limit?: number
}

export interface PlaneCreateCommentParams extends PlaneWorkItemScopedParams {
  comment: string
  access?: 'INTERNAL' | 'EXTERNAL'
  externalId?: string
  externalSource?: string
}

export interface PlaneUpdateCommentParams extends PlaneWorkItemScopedParams {
  commentId: string
  comment: string
}

export interface PlaneDeleteCommentParams extends PlaneWorkItemScopedParams {
  commentId: string
}

export type PlaneListCommentsParams = PlaneWorkItemScopedParams & PlanePaginationParams

export interface PlaneCreateLinkParams extends PlaneWorkItemScopedParams {
  url: string
  title?: string
}

export type PlaneListLinksParams = PlaneWorkItemScopedParams & PlanePaginationParams

export interface PlaneDeleteLinkParams extends PlaneWorkItemScopedParams {
  linkId: string
}

export type PlaneListAttachmentsParams = PlaneWorkItemScopedParams

export interface PlaneUploadAttachmentParams extends PlaneWorkItemScopedParams {
  file: UserFile | string
}

export interface PlaneDownloadAttachmentParams extends PlaneWorkItemScopedParams {
  attachmentId: string
}

export interface PlaneDeleteAttachmentParams extends PlaneWorkItemScopedParams {
  attachmentId: string
}

export interface PlaneListProjectsParams extends PlaneBaseParams, PlanePaginationParams {
  orderBy?: string
}

export type PlaneGetProjectParams = PlaneProjectScopedParams

export interface PlaneCreateProjectParams extends PlaneBaseParams {
  name: string
  identifier: string
  description?: string
  projectLeadId?: string
  defaultAssigneeId?: string
  timezone?: string
}

export type PlaneListStatesParams = PlaneProjectScopedParams & PlanePaginationParams

export type PlaneListLabelsParams = PlaneProjectScopedParams & PlanePaginationParams

export interface PlaneCreateLabelParams extends PlaneProjectScopedParams {
  name: string
  color?: string
  description?: string
  parentId?: string
}

export type PlaneListWorkspaceMembersParams = PlaneBaseParams

export type PlaneListProjectMembersParams = PlaneProjectScopedParams

export interface PlaneGetCurrentUserParams {
  apiKey: string
  baseUrl?: string
}

export interface PlaneListCyclesParams extends PlaneProjectScopedParams, PlanePaginationParams {
  cycleView?: 'all' | 'current' | 'upcoming' | 'completed' | 'draft' | 'incomplete'
}

export interface PlaneAddWorkItemsToCycleParams extends PlaneProjectScopedParams {
  cycleId: string
  workItemIds: string | string[]
}

export type PlaneListModulesParams = PlaneProjectScopedParams & PlanePaginationParams

export interface PlaneAddWorkItemsToModuleParams extends PlaneProjectScopedParams {
  moduleId: string
  workItemIds: string | string[]
}

export type PlaneListActivitiesParams = PlaneWorkItemScopedParams & PlanePaginationParams

export interface PlaneWorkItemResponse extends ToolResponse {
  output: { workItem: PlaneWorkItem }
}

export interface PlaneWorkItemListResponse extends ToolResponse {
  output: { workItems: PlaneWorkItem[] } & PlanePagination
}

export interface PlaneSearchWorkItemsResponse extends ToolResponse {
  output: { results: PlaneSearchResult[] }
}

export interface PlaneDeleteResponse extends ToolResponse {
  output: { deleted: boolean; id: string }
}

export interface PlaneCommentResponse extends ToolResponse {
  output: { comment: PlaneComment }
}

export interface PlaneCommentListResponse extends ToolResponse {
  output: { comments: PlaneComment[] } & PlanePagination
}

export interface PlaneLinkResponse extends ToolResponse {
  output: { link: PlaneLink }
}

export interface PlaneLinkListResponse extends ToolResponse {
  output: { links: PlaneLink[] } & PlanePagination
}

export interface PlaneAttachmentListResponse extends ToolResponse {
  output: { attachments: PlaneAttachment[] }
}

export interface PlaneUploadAttachmentResponse extends ToolResponse {
  output: { attachment: PlaneAttachment }
}

export interface PlaneDownloadAttachmentResponse extends ToolResponse {
  output: { file: ToolFileData }
}

export interface PlaneProjectResponse extends ToolResponse {
  output: { project: PlaneProject }
}

export interface PlaneProjectListResponse extends ToolResponse {
  output: { projects: PlaneProject[] } & PlanePagination
}

export interface PlaneStateListResponse extends ToolResponse {
  output: { states: PlaneState[] } & PlanePagination
}

export interface PlaneLabelResponse extends ToolResponse {
  output: { label: PlaneLabel }
}

export interface PlaneLabelListResponse extends ToolResponse {
  output: { labels: PlaneLabel[] } & PlanePagination
}

export interface PlaneWorkspaceMemberListResponse extends ToolResponse {
  output: { members: PlaneWorkspaceMember[] }
}

export interface PlaneProjectMemberListResponse extends ToolResponse {
  output: { members: PlaneUser[] }
}

export interface PlaneUserResponse extends ToolResponse {
  output: { user: PlaneUser }
}

export interface PlaneCycleListResponse extends ToolResponse {
  output: { cycles: PlaneCycle[] } & PlanePagination
}

export interface PlaneModuleListResponse extends ToolResponse {
  output: { modules: PlaneModule[] } & PlanePagination
}

export interface PlaneAddWorkItemsResponse extends ToolResponse {
  output: { workItemIds: string[] }
}

export interface PlaneActivityListResponse extends ToolResponse {
  output: { activities: PlaneActivity[] } & PlanePagination
}
