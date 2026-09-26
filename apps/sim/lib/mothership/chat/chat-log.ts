import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import type { OrchestratorResult } from '@/lib/mothership/request/types'

const logger = createLogger('ChatLog')

const CHAT_LOG_TIMEOUT_MS = 5_000

/** The turn a Chat send admitted — rebuilt when a relay pod recovers it. */
export interface ChatTurnLogContext {
  chatId: string
  messageId: string
  requestId: string
  userId: string
  userEmail?: string
  userMessage: string
  mode: 'assistant' | 'agent' | 'plan'
  startedAt: number
}

export type ChatTurnStatus = 'success' | 'error' | 'aborted'

/** The user's email for a recovered turn, whose send-time session is gone; skipped when the log is off. */
export async function readChatLogEmail(userId: string): Promise<string | undefined> {
  if (!env.SIM_LOGGING_WORKFLOW_URL) return undefined
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return row?.email
}

/**
 * Operator funnel: posts each finished Chat turn to the Sim workflow at
 * `SIM_LOGGING_WORKFLOW_URL` (off when unset). The body keeps the shape the Go
 * copilot sent — `{ input: { event: 'copilot_request_completed', ... } }` — so the
 * existing workflow reads it unchanged. Fire-and-forget: never awaited, never throws.
 */
export function logChatTurn(
  context: ChatTurnLogContext,
  result: OrchestratorResult,
  status: ChatTurnStatus
): void {
  const url = env.SIM_LOGGING_WORKFLOW_URL
  if (!url) return
  const durationMs = Date.now() - context.startedAt
  void sendChatTurn(url, context, result, status, durationMs).catch((error) => {
    logger.warn('Chat log workflow request failed', {
      chatId: context.chatId,
      requestId: context.requestId,
      error: getErrorMessage(error),
    })
  })
}

async function sendChatTurn(
  url: string,
  context: ChatTurnLogContext,
  result: OrchestratorResult,
  status: ChatTurnStatus,
  durationMs: number
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.SIM_LOGGING_WORKFLOW_API_KEY) headers['X-API-Key'] = env.SIM_LOGGING_WORKFLOW_API_KEY

  const input = {
    event: 'copilot_request_completed',
    idempotencyKey: context.messageId,
    requestId: context.requestId,
    chatId: context.chatId,
    messageId: context.messageId,
    userId: context.userId,
    userEmail: context.userEmail,
    userMessage: context.userMessage,
    assistantResponse: result.content,
    status,
    errored: status === 'error',
    aborted: status === 'aborted',
    errorMessage: result.error ?? result.errors?.join('\n'),
    mode: context.mode,
    source: 'workspace-chat',
    startedAt: new Date(context.startedAt).toISOString(),
    durationMs,
    usage: {
      inputTokens: result.usage?.prompt ?? 0,
      outputTokens: result.usage?.completion ?? 0,
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(CHAT_LOG_TIMEOUT_MS),
  })
  await response.body?.cancel()
  if (!response.ok) {
    logger.warn('Chat log workflow returned a non-2xx status', {
      status: response.status,
      chatId: context.chatId,
      requestId: context.requestId,
    })
  }
}
