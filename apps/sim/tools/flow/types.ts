import type {
  mapFlowBranch,
  mapFlowCategory,
  mapFlowComment,
  mapFlowEntity,
  mapFlowHistoryEntry,
  mapFlowProject,
  mapFlowSearchResult,
} from '@/tools/flow/utils'
import type { ToolResponse } from '@/tools/types'

export interface FlowAuthParams {
  accessToken: string
  domain: string
  providerWorkspaceId: string
}

export interface FlowListProjectsParams extends FlowAuthParams {
  limit?: number
}

export interface FlowListProjectsResponse extends ToolResponse {
  output: { projects: ReturnType<typeof mapFlowProject>[] }
}

export interface FlowGetProjectParams extends FlowAuthParams {
  projectId: string
}

export interface FlowGetProjectResponse extends ToolResponse {
  output: { project: ReturnType<typeof mapFlowProject> }
}

export interface FlowGetDataModelParams extends FlowAuthParams {
  projectId: string
}

export interface FlowGetDataModelResponse extends ToolResponse {
  output: { categories: ReturnType<typeof mapFlowCategory>[] }
}

export interface FlowListBranchesParams extends FlowAuthParams {
  projectId: string
}

export interface FlowListBranchesResponse extends ToolResponse {
  output: { branches: ReturnType<typeof mapFlowBranch>[] }
}

export interface FlowCreateBranchParams extends FlowAuthParams {
  projectId: string
  branchName?: string
  parentId?: string
  description?: string
  isVariant?: boolean
}

export interface FlowCreateBranchResponse extends ToolResponse {
  output: { id: string; number: number }
}

export interface FlowSearchEntitiesParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  entityType?: string
  query: string
  limit?: number
}

export interface FlowSearchEntitiesResponse extends ToolResponse {
  output: { matches: ReturnType<typeof mapFlowSearchResult>[] }
}

export interface FlowListEntitiesParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  entityType?: string
  cursor?: string
  limit?: number
}

export interface FlowListEntitiesResponse extends ToolResponse {
  output: {
    entities: ReturnType<typeof mapFlowEntity>[]
    nextPageStart: string | null
    moreAvailable: boolean
  }
}

export interface FlowGetEntitiesParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  entityIds: string
}

export interface FlowGetEntitiesResponse extends ToolResponse {
  output: { entities: ReturnType<typeof mapFlowEntity>[] }
}

export interface FlowCreateEntityParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  entityType: string
  name: string
}

export interface FlowCreateEntityResponse extends ToolResponse {
  output: { entity: ReturnType<typeof mapFlowEntity> }
}

export interface FlowCreateEntitiesParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  entities: unknown
}

export interface FlowCreateEntitiesResponse extends ToolResponse {
  output: { entities: ReturnType<typeof mapFlowEntity>[] }
}

export interface FlowSetValueParams extends FlowAuthParams {
  projectId: string
  entityId: string
  branchId?: string
  fieldKey: string
  value: string
}

export interface FlowSetValueResponse extends ToolResponse {
  output: { entity: ReturnType<typeof mapFlowEntity> }
}

export interface FlowSetValuesParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  updates: unknown
}

export interface FlowSetValuesResponse extends ToolResponse {
  output: { entities: ReturnType<typeof mapFlowEntity>[] }
}

export interface FlowDeleteEntityParams extends FlowAuthParams {
  projectId: string
  entityId: string
  branchId?: string
}

export interface FlowDeleteEntityResponse extends ToolResponse {
  output: Record<string, never>
}

export interface FlowRestoreEntityParams extends FlowAuthParams {
  projectId: string
  entityId: string
  branchId?: string
}

export interface FlowRestoreEntityResponse extends ToolResponse {
  output: Record<string, never>
}

export interface FlowAddLinkParams extends FlowAuthParams {
  projectId: string
  entityId: string
  branchId?: string
  destinationId: string
}

export interface FlowAddLinkResponse extends ToolResponse {
  output: { entity: ReturnType<typeof mapFlowEntity> }
}

export interface FlowRemoveLinkParams extends FlowAuthParams {
  projectId: string
  entityId: string
  branchId?: string
  destinationId: string
}

export interface FlowRemoveLinkResponse extends ToolResponse {
  output: { entity: ReturnType<typeof mapFlowEntity> }
}

export interface FlowListCommentsParams extends FlowAuthParams {
  projectId: string
  entityId: string
  branchId?: string
  includeResolved?: boolean
}

export interface FlowListCommentsResponse extends ToolResponse {
  output: { comments: ReturnType<typeof mapFlowComment>[] }
}

export interface FlowGetCommentParams extends FlowAuthParams {
  projectId: string
  entityId: string
  commentId: string
}

export interface FlowGetCommentResponse extends ToolResponse {
  output: { comment: ReturnType<typeof mapFlowComment> }
}

export interface FlowCreateCommentParams extends FlowAuthParams {
  projectId: string
  entityId: string
  branchId?: string
  text: string
}

export interface FlowCreateCommentResponse extends ToolResponse {
  output: { comment: ReturnType<typeof mapFlowComment> }
}

export interface FlowUpdateCommentParams extends FlowAuthParams {
  projectId: string
  entityId: string
  commentId: string
  text?: string
  resolved?: boolean
}

export interface FlowUpdateCommentResponse extends ToolResponse {
  output: { comment: ReturnType<typeof mapFlowComment> }
}

export interface FlowDeleteCommentParams extends FlowAuthParams {
  projectId: string
  entityId: string
  commentId: string
}

export interface FlowDeleteCommentResponse extends ToolResponse {
  output: Record<string, never>
}

export interface FlowFilterEntitiesParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  filter: unknown
  cursor?: string
  limit?: number
  timezone?: string
}

export interface FlowFilterEntitiesResponse extends ToolResponse {
  output: { entityIds: string[]; nextCursor: string | null }
}

export interface FlowGetEntityHistoryParams extends FlowAuthParams {
  projectId: string
  branchId?: string
  entityIds: string
  cursor?: string
  limit?: number
}

export interface FlowGetEntityHistoryResponse extends ToolResponse {
  output: { entries: ReturnType<typeof mapFlowHistoryEntry>[]; nextCursor: string | null }
}
