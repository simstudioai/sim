import {
  v2CreateChatDeploymentContract,
  v2ListChatDeploymentsContract,
} from '@/lib/api/contracts/v2/chat-deployments'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import {
  chatDeploymentOperations,
  listChatDeployments,
  toChatDeploymentView,
} from '@/lib/chat-deployments/application'
import { generateRequestId } from '@/lib/core/utils/request'
import { deployWorkflowChat } from '@/lib/workflows/application/chat-deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { chatDeploymentErrorPolicy, toV2ChatDeployment } from '@/app/api/v2/chat-deployments/utils'
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
 */
export const GET = defineV2JsonRoute({
  contract: v2ListChatDeploymentsContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
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
    data: deployments.map((deployment) => toV2ChatDeployment(deployment, query.workspaceId)),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      chatDeploymentCursorFilters(query)
    ),
  }),
})

/**
 * POST /api/v2/chat-deployments — Publish a workflow as a chat.
 *
 * This also deploys the workflow: a chat serves the live version, so a draft
 * that has drifted is republished as part of the call. Deployment settles
 * asynchronously, and a call that lands while another attempt is still
 * preparing is a `409` rather than a second admitted version.
 *
 * A workflow carries at most one live chat deployment, so calling this for a
 * workflow that already has one updates it in place.
 */
export const POST = defineV2JsonRoute({
  contract: v2CreateChatDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.deployChat,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
  mapInput: ({ body }) => ({ ...body, requestId: generateRequestId() }),
  useCase: deployWorkflowChat,
  present: (result) => ({
    data: toV2ChatDeployment(toChatDeploymentView(result.deployment), result.workspaceId),
  }),
})
