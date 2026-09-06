/**
 * The wake door of copilot background tasks (mothership docs/revamp/21-background-tasks.md
 * §6.3): the worker delivers a task's notification to an idle chat by asking sim to open a
 * turn with the notification as its message. It runs the same headless lifecycle the inbox
 * uses — no browser, sim executes the turn's tools and persists both messages — and
 * announces itself through the chat status channel exactly like a typed turn, so an open
 * chat attaches to the live stream and a closed one shows the new turn on return.
 */
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import { buildIntegrationToolSchemas } from '@/lib/mothership/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
} from '@/lib/mothership/chat/persisted-message'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { PROTOCOL_VERSION } from '@/lib/mothership/generated/protocol'
import type { TaskWakeRequest as WakeRequest } from '@/lib/mothership/generated/tasks'
import { runHeadlessCopilotLifecycle } from '@/lib/mothership/request/lifecycle/headless'
import { releasePendingChatStream } from '@/lib/mothership/request/session/abort'
import { TASK_DELEGATION_AUDIENCE } from '@/lib/mothership/tasks/application/context'
import { authorizeTaskWake } from '@/lib/mothership/tasks/application/prepare-wake'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotTaskWake')

/** Runs the wake turn to completion; the caller has already answered the worker. */
export async function runWakeTurn(input: WakeRequest): Promise<void> {
  const { taskId, chatId, workspaceId, userId, message, runId } = input
  const userMessageId = runId
  chatPubSub?.publishStatusChanged({
    workspaceId,
    chatId,
    type: 'started',
    streamId: userMessageId,
  })
  try {
    await authorizeTaskWake({
      principal: createTrustedCopilotPrincipal(
        { userId, workspaceId, delegationId: `wake:${runId}` },
        { audience: TASK_DELEGATION_AUDIENCE, ttlMs: 60_000 }
      ),
      input,
    })
    const [access, integrationTools, billingAttribution] = await Promise.all([
      checkWorkspaceAccess(workspaceId, userId),
      buildIntegrationToolSchemas(userId, undefined, undefined, workspaceId),
      resolveBillingAttribution({ actorUserId: userId, workspaceId }),
    ])
    const requestPayload: Record<string, unknown> = {
      message,
      userId,
      protocolVersion: PROTOCOL_VERSION,
      workspaceId,
      chatId,
      messageId: userMessageId,
      origin: 'task',
      ...(integrationTools.length > 0 ? { integrationTools } : {}),
    }
    const result = await runHeadlessCopilotLifecycle(requestPayload, {
      userId,
      workspaceId,
      chatId,
      goRoute: '/api/mothership',
      autoExecuteTools: true,
      interactive: false,
      billingAttribution,
      ...(access.permission ? { userPermission: access.permission } : {}),
    })
    if (result.success && !result.content && result.contentBlocks.length === 0) return
    const userMessage = buildPersistedUserMessage({
      id: userMessageId,
      content: message,
      origin: 'task',
    })
    const assistantMessage = buildPersistedAssistantMessage(result)
    await appendCopilotChatMessages(chatId, [userMessage, assistantMessage], {
      streamId: userMessageId,
    })
    logger.info('Wake turn complete', { taskId, chatId, success: result.success })
  } catch (error) {
    logger.error('Wake turn failed', { taskId, chatId, error: getErrorMessage(error) })
  } finally {
    await releasePendingChatStream(chatId, userMessageId)
    chatPubSub?.publishStatusChanged({
      workspaceId,
      chatId,
      type: 'completed',
      streamId: userMessageId,
    })
  }
}
