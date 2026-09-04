/**
 * The wake door of copilot background tasks (mothership docs/revamp/21-background-tasks.md
 * §6.3): the worker delivers a task's notification to an idle chat by asking sim to open a
 * turn with the notification as its message. It runs the same headless lifecycle the inbox
 * uses — no browser, sim executes the turn's tools and persists both messages — and
 * announces itself through the chat status channel exactly like a typed turn, so an open
 * chat attaches to the live stream and a closed one shows the new turn on return.
 */
import { copilotChats, copilotMessages, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import { buildIntegrationToolSchemas } from '@/lib/mothership/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
} from '@/lib/mothership/chat/persisted-message'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { PROTOCOL_VERSION } from '@/lib/mothership/generated/protocol'
import { runHeadlessCopilotLifecycle } from '@/lib/mothership/request/lifecycle/headless'
import {
  acquirePendingChatStream,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotTaskWake')

export interface WakeRequest {
  taskId: string
  chatId: string
  workspaceId: string
  userId: string
  message: string
  /** The task's outcome, for the pill in the turn that armed it. */
  status?: 'completed' | 'failed' | 'stopped' | 'expired'
  summary?: string
}

/**
 * Resolves the "watching" pill: the assistant message that armed the task keeps a
 * `task` block whose status is pending until the outcome arrives — a steer resolves it
 * live through `task_delivered`, a wake resolves it here before the new turn lands.
 */
export async function resolveTaskPill(
  chatId: string,
  taskId: string,
  status: NonNullable<WakeRequest['status']>,
  summary: string
): Promise<void> {
  const rows = await db
    .select({ id: copilotMessages.id, content: copilotMessages.content })
    .from(copilotMessages)
    .where(
      and(
        eq(copilotMessages.chatId, chatId),
        // The id alone is the filter — jsonb text puts a space after every colon, so a
        // `"taskId":"…"` pattern never matches; the block walk below is the real check.
        sql`${copilotMessages.content}::text LIKE ${`%${taskId}%`}`
      )
    )
  for (const row of rows) {
    const content = row.content as {
      contentBlocks?: Array<{ type?: string; task?: TaskBlockInfo }>
    }
    const blocks = content.contentBlocks
    if (!Array.isArray(blocks)) continue
    let touched = false
    for (const block of blocks) {
      if (block.type === 'task' && block.task?.taskId === taskId) {
        block.task = { ...block.task, status, summary }
        touched = true
      }
    }
    if (touched) {
      await db.update(copilotMessages).set({ content }).where(eq(copilotMessages.id, row.id))
    }
  }
}

export async function validateWake(
  input: WakeRequest
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [chat] = await db
    .select({ userId: copilotChats.userId, workspaceId: copilotChats.workspaceId })
    .from(copilotChats)
    .where(eq(copilotChats.id, input.chatId))
    .limit(1)
  if (!chat || chat.workspaceId !== input.workspaceId || chat.userId !== input.userId) {
    return { ok: false, status: 404, error: 'Chat not found for this user and workspace' }
  }
  const banned = await getActivelyBannedUserIds([input.userId])
  if (banned.length > 0) return { ok: false, status: 403, error: 'User account is suspended' }
  const access = await checkWorkspaceAccess(input.workspaceId, input.userId)
  if (!access.permission) return { ok: false, status: 403, error: 'No workspace access' }
  return { ok: true }
}

/** Runs the wake turn to completion; the caller has already answered the worker. */
export async function runWakeTurn(input: WakeRequest): Promise<void> {
  const { taskId, chatId, workspaceId, userId, message } = input
  if (input.status) {
    await resolveTaskPill(chatId, taskId, input.status, input.summary ?? '').catch((error) => {
      logger.warn('Could not resolve the task pill', {
        taskId,
        chatId,
        error: getErrorMessage(error),
      })
    })
  }
  // The task id is the turn's message id: the worker's duplicate-send preflight makes a
  // retried wake attach to the running turn instead of driving it twice.
  const userMessageId = taskId
  const locked = await acquirePendingChatStream(chatId, userMessageId)
  if (!locked) {
    logger.warn('Wake skipped: another stream holds the chat', { taskId, chatId })
    return
  }
  chatPubSub?.publishStatusChanged({
    workspaceId,
    chatId,
    type: 'started',
    streamId: userMessageId,
  })
  try {
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
