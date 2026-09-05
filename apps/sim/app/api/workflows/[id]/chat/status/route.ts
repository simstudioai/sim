import { getChatDeploymentStatusContract } from '@/lib/api/contracts/deployments'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  chatDeploymentOperations,
  readWorkflowChatDeploymentStatus,
} from '@/lib/chat-deployments/application'
import { createInternalChatDeploymentErrorPolicy } from '@/app/api/chat/error-policy'

/**
 * GET — whether a workflow publishes a chat, and which one.
 *
 * This previously reimplemented a deployment read inline behind a bare workflow
 * `read` check, serving the `allowedEmails` allow-list, `hasPassword` and the
 * customization blob to any workspace viewer. The editor now gets those from
 * `/api/chat/manage/{id}`, which gates them at workspace admin.
 */
export const GET = defineInternalJsonRoute({
  contract: getChatDeploymentStatusContract,
  auth: internalSessionAuth,
  operation: chatDeploymentOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI chat status reads retain their existing admission policy.',
  }),
  errorPolicy: createInternalChatDeploymentErrorPolicy('Failed to check chat deployment status'),
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: readWorkflowChatDeploymentStatus,
  present: ({ isDeployed, deployment }) => ({ isDeployed, deployment }),
})
