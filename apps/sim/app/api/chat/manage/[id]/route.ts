import { deleteChatContract, updateChatContract } from '@/lib/api/contracts/chats'
import { getChatDetailContract } from '@/lib/api/contracts/deployments'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  chatDeploymentOperations,
  deleteChatDeployment,
  readChatDeployment,
  updateChatDeployment,
} from '@/lib/chat-deployments/application'
import { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'
import { createInternalChatDeploymentErrorPolicy } from '@/app/api/chat/error-policy'
import { toChatDetailResponse } from '@/app/api/chat/presenters'
import { createErrorResponse } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * The workspace editor's chat-deployment surface.
 *
 * Every method is an adapter over the same application use cases the public API
 * and the Copilot tools call. Authorization, the auth-type field-clearing
 * matrix, identifier uniqueness, and the redeploy-gating protocol live in
 * `lib/chat-deployments/application`; this file owns only session
 * authentication and the editor's wire shapes.
 */
export const GET = defineInternalJsonRoute({
  contract: getChatDetailContract,
  auth: internalSessionAuth,
  operation: chatDeploymentOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI chat reads retain their existing admission policy.',
  }),
  errorPolicy: createInternalChatDeploymentErrorPolicy('Failed to fetch chat deployment'),
  mapInput: ({ params }) => ({ chatDeploymentId: params.id }),
  useCase: readChatDeployment,
  present: ({ deployment }) =>
    toChatDetailResponse(deployment, buildChatDeploymentUrl(deployment.identifier)),
})

export const PATCH = defineInternalJsonRoute({
  contract: updateChatContract,
  auth: internalSessionAuth,
  operation: chatDeploymentOperations.update,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI chat updates retain their existing admission policy.',
  }),
  errorPolicy: createInternalChatDeploymentErrorPolicy('Failed to update chat deployment'),
  parseOptions: {
    /**
     * The editor renders `error` verbatim, so a contract refusal has to name the
     * field it refused — the builder default renders every 400 as the literal
     * "Validation error" and demotes the specifics to `details`.
     */
    validationErrorResponse: (error) =>
      createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
  },
  mapInput: ({ params, body }) => ({ chatDeploymentId: params.id, ...body }),
  useCase: updateChatDeployment,
  present: ({ deployment, chatUrl }) => ({
    id: deployment.id,
    chatUrl,
    message: 'Chat deployment updated successfully',
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteChatContract,
  auth: internalSessionAuth,
  operation: chatDeploymentOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI chat deletions retain their existing admission policy.',
  }),
  errorPolicy: createInternalChatDeploymentErrorPolicy('Failed to delete chat deployment'),
  mapInput: ({ params }) => ({ chatDeploymentId: params.id }),
  useCase: deleteChatDeployment,
  present: () => ({ message: 'Chat deployment deleted successfully' }),
})
