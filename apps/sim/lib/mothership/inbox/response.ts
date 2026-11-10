import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { renderInboxErrorEmail, renderInboxResponseEmail } from '@/components/emails'
import { getBaseUrl } from '@/lib/core/utils/urls'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'
import { replaceUntilStable } from '@/lib/mothership/inbox/format'
import type { InboxTask } from '@/lib/mothership/inbox/types'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('InboxResponse')

interface InboxResponseContext {
  inboxProviderId: string | null
  workspaceId: string
}

/**
 * Send the mothership execution result as an email reply via AgentMail.
 * Returns the AgentMail response message ID for thread stitching, or null on failure.
 */
export async function sendInboxResponse(
  inboxTask: InboxTask,
  result: { success: boolean; content: string; error?: string },
  ctx: InboxResponseContext
): Promise<string | null> {
  if (!ctx.inboxProviderId || !inboxTask.agentmailMessageId) {
    logger.warn('Cannot send response: missing inbox provider or message ID', {
      taskId: inboxTask.id,
    })
    return null
  }

  const chatUrl = inboxTask.chatId
    ? `${getBaseUrl()}/workspace/${ctx.workspaceId}/chat/${inboxTask.chatId}`
    : `${getBaseUrl()}/workspace/${ctx.workspaceId}/home`

  const brandName = getBrandConfig().name

  const text = result.success
    ? `${result.content}\n\n[View full conversation](${chatUrl})\n\nBest,\n${brandName}`
    : `I wasn't able to complete this task.\n\nError: ${result.error || 'Unknown error'}\n\n[View details](${chatUrl})\n\nBest,\n${brandName}`

  const html = result.success
    ? await renderInboxResponseEmail({
        markdown: preserveSoftBreaks(stripRawHtml(result.content)),
        chatUrl,
      })
    : await renderInboxErrorEmail({ error: result.error || 'Unknown error', chatUrl })

  try {
    const response = await agentmail.replyToMessage(
      ctx.inboxProviderId,
      inboxTask.agentmailMessageId,
      { text, html }
    )

    logger.info('Inbox response sent', { taskId: inboxTask.id, responseId: response.message_id })
    return response.message_id
  } catch (error) {
    logger.error('Failed to send inbox response email', {
      taskId: inboxTask.id,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return null
  }
}

function stripRawHtml(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((segment, i) =>
      i % 2 === 0 ? replaceUntilStable(segment, /<\/?[a-z][^>]*>/gi, '') : segment
    )
    .join('')
}

function preserveSoftBreaks(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((segment, i) => (i % 2 === 0 ? segment.replace(/([^\n])\n(?=[^\n])/g, '$1  \n') : segment))
    .join('')
}
