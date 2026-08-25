import { createChatContract } from '@/lib/api/contracts/chats'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { generateRequestId } from '@/lib/core/utils/request'
import { deployWorkflowChat } from '@/lib/workflows/application/chat-deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { createInternalChatDeploymentErrorPolicy } from '@/app/api/chat/error-policy'
import { createErrorResponse } from '@/app/api/workflows/utils'

/**
 * Deploys a workflow as a chat.
 *
 * An adapter over `workflows.chat.deploy` — the same use case the Copilot
 * `deploy_chat` tool calls. The route previously reimplemented that operation's
 * authorization, identifier-uniqueness check, and auth-mode policy inline, so
 * the two could disagree about who may deploy a chat.
 */
export const POST = defineInternalJsonRoute({
  contract: createChatContract,
  auth: internalSessionAuth,
  operation: workflowOperations.deployChat,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI chat deployments retain their existing admission policy.',
  }),
  errorPolicy: createInternalChatDeploymentErrorPolicy('Failed to create chat deployment'),
  parseOptions: {
    /**
     * The editor's deploy modal renders `error` verbatim, so a contract refusal
     * has to name the field it refused — the builder default renders every 400
     * as the literal "Validation error" and demotes the specifics to `details`.
     */
    validationErrorResponse: (error) =>
      createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
  },
  mapInput: ({ body }) => ({ ...body, requestId: generateRequestId() }),
  useCase: deployWorkflowChat,
  present: (result) => ({
    id: result.chatId,
    chatId: result.chatId,
    chatUrl: result.chatUrl,
    message: 'Chat deployment created successfully',
  }),
})
