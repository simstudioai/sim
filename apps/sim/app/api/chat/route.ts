import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createChatContract } from '@/lib/api/contracts/chats'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deployWorkflowChat } from '@/lib/workflows/application/chat-deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { createInternalChatDeploymentErrorPolicy } from '@/app/api/chat/error-policy'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatAPI')

/**
 * Lists the chat deployments the session user created, across every workspace.
 *
 * Deliberately NOT migrated to an application use case with the rest of this
 * surface: every other chat operation authorizes by workspace admin, while this
 * one scopes by `chat.userId`, so a workspace admin does not see a colleague's
 * deployment here. Reconciling the two changes what the editor lists and needs a
 * product ruling; the workspace-scoped reading is published separately as
 * `GET /api/v2/chat-deployments` rather than being retrofitted here.
 */
export const GET = withRouteHandler(async (_request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const deployments = await db
      .select()
      .from(chat)
      .where(and(eq(chat.userId, session.user.id), isNull(chat.archivedAt)))

    return createSuccessResponse({
      deployments: deployments.map((deployment) => ({
        ...deployment,
        includeToolCalls: deployment.includeToolCalls ?? false,
      })),
    })
  } catch (error) {
    logger.error('Error fetching chat deployments:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to fetch chat deployments'), 500)
  }
})

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
  mapInput: ({ body }) => ({ ...body, requestId: generateRequestId() }),
  useCase: deployWorkflowChat,
  present: (result) => ({
    id: result.chatId,
    chatId: result.chatId,
    chatUrl: result.chatUrl,
    message: 'Chat deployment created successfully',
  }),
})
