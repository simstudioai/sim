import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { validateAuthToken } from '@/lib/core/security/deployment'

const logger = createLogger('DeployedChatCaller')

export type DeployedChatCaller =
  | { authorized: false }
  | { authorized: true; ownerId: string; workspaceId: string | null }

/**
 * Resolves whether a caller may act on a deployed chat, and who pays for it.
 *
 * Anonymous visitors of a public chat are authorized, so callers that spend a
 * platform credential must meter against the returned payer rather than treat
 * authorization as permission to spend freely.
 *
 * Shared by every deployed-chat surface that bills a vendor call, so the gate
 * and the payer are resolved together and cannot drift apart per route.
 */
export async function resolveDeployedChatCaller(
  request: NextRequest,
  chatId: string
): Promise<DeployedChatCaller> {
  try {
    const rows = await db
      .select({
        userId: chat.userId,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
        workspaceId: workflow.workspaceId,
      })
      .from(chat)
      .leftJoin(workflow, eq(workflow.id, chat.workflowId))
      .where(and(eq(chat.id, chatId), isNull(chat.archivedAt)))
      .limit(1)

    if (rows.length === 0 || !rows[0].isActive) {
      logger.warn('Chat not found, archived or inactive', { chatId })
      return { authorized: false }
    }

    const chatData = rows[0]
    const authorized = {
      authorized: true,
      ownerId: chatData.userId,
      workspaceId: chatData.workspaceId,
    } as const

    if (chatData.authType === 'public') {
      return authorized
    }

    const authCookie = request.cookies.get(`chat_auth_${chatId}`)
    if (
      authCookie &&
      validateAuthToken(authCookie.value, chatId, chatData.authType, chatData.password)
    ) {
      return authorized
    }

    return { authorized: false }
  } catch (error) {
    logger.error('Error resolving deployed chat caller', { chatId, error })
    return { authorized: false }
  }
}
