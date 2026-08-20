import {
  v2DeleteChatDeploymentContract,
  v2GetChatDeploymentContract,
  v2UpdateChatDeploymentContract,
} from '@/lib/api/contracts/v2/chat-deployments'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import {
  chatDeploymentOperations,
  deleteChatDeployment,
  readChatDeployment,
  updateChatDeployment,
} from '@/lib/chat-deployments/application'
import { chatDeploymentErrorPolicy, toV2ChatDeployment } from '@/app/api/v2/chat-deployments/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** GET /api/v2/chat-deployments/[chatDeploymentId] — Read one chat deployment. */
export const GET = defineV2JsonRoute({
  contract: v2GetChatDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
  mapInput: ({ params }) => ({ chatDeploymentId: params.chatDeploymentId }),
  useCase: readChatDeployment,
  present: ({ deployment, workspaceId }) => ({
    data: toV2ChatDeployment(deployment, workspaceId),
  }),
})

/**
 * PATCH /api/v2/chat-deployments/[chatDeploymentId] — Update a chat deployment.
 *
 * Switching `authType` clears the gate the previous mode owned, so a stored
 * password does not survive a move to email gating and an allow-list does not
 * survive a move to public. A `password` sent alongside a non-password mode is
 * ignored rather than stored.
 *
 * Like create, this republishes the workflow when its draft has drifted, so it
 * inherits the same `409` while a deployment attempt is in flight.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateChatDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.update,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
  mapInput: ({ params, body }) => ({
    chatDeploymentId: params.chatDeploymentId,
    ...body,
  }),
  useCase: updateChatDeployment,
  present: ({ deployment, workspaceId }) => ({
    data: toV2ChatDeployment(deployment, workspaceId),
  }),
})

/**
 * DELETE /api/v2/chat-deployments/[chatDeploymentId] — Stop serving a chat.
 *
 * The workflow's own deployment is untouched: it stays live and executable
 * through the workflow API.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteChatDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
  mapInput: ({ params }) => ({ chatDeploymentId: params.chatDeploymentId }),
  useCase: deleteChatDeployment,
  present: ({ deployment }) => ({ data: { id: deployment.id, deleted: true as const } }),
})
