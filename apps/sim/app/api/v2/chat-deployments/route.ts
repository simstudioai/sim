import { v2ListChatDeploymentsContract } from '@/lib/api/contracts/v2/chat-deployments'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { listChatDeployments } from '@/lib/chat-deployments/application'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import {
  chatDeploymentWorkspaceErrorPolicy,
  toV2ChatDeploymentListItem,
} from '@/app/api/v2/chat-deployments/utils'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Every param that changes which deployments, in which order, this list returns. */
function chatDeploymentCursorFilters(query: {
  workspaceId: string
  workflowId?: string
  isActive?: boolean
}) {
  return cursorScopeKey(cursorRoute(v2ListChatDeploymentsContract), {
    workspaceId: query.workspaceId,
    workflowId: query.workflowId,
    isActive: query.isActive,
  })
}

/**
 * GET /api/v2/chat-deployments — List a workspace's chat deployments.
 *
 * Workspace-scoped, not creator-scoped: a chat deployment is workspace
 * property, and every write on it is authorized by workspace admin.
 *
 * The only chat-deployment path that is not under a workflow, and deliberately
 * so. Every write addresses one workflow's chat singleton at
 * `/api/v2/workflows/{workflowId}/deployments/chat`, but "what does this workspace
 * serve" is a cross-parent question no per-workflow path can answer. Filter by
 * `workflowId` to resolve one workflow's chat without holding its id.
 *
 * Deliberately a narrower projection than the detail read. Discovery is a
 * `read`-level concern, so this stays callable by any workspace member and by a
 * workspace API key — which is only sound because the entries carry no
 * `allowedEmails`, `hasPassword`, or `customizations`. Those live on the
 * admin-gated detail read, so the list cannot be used to route around it.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListChatDeploymentsContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentWorkspaceErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    workflowId: query.workflowId,
    isActive: query.isActive,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      chatDeploymentCursorFilters(query)
    ),
  }),
  useCase: listChatDeployments,
  present: ({ deployments, nextCursorKeys }, { query }) => ({
    data: deployments.map((deployment) =>
      toV2ChatDeploymentListItem(deployment, query.workspaceId)
    ),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      chatDeploymentCursorFilters(query)
    ),
  }),
})
