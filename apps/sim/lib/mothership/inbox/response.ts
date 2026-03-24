import { createLogger } from '@sim/logger'
import { marked } from 'marked'
import { getBaseUrl } from '@/lib/core/utils/urls'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'
import { replaceUntilStable } from '@/lib/mothership/inbox/format'
import type { InboxTask } from '@/lib/mothership/inbox/types'

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
    ? `${getBaseUrl()}/workspace/${ctx.workspaceId}/task/${inboxTask.chatId}`
    : `${getBaseUrl()}/workspace/${ctx.workspaceId}/home`

  const text = result.success
    ? `${result.content}\n\n[View full conversation](${chatUrl})\n\nBest,\nMothership`
    : `I wasn't able to complete this task.\n\nError: ${result.error || 'Unknown error'}\n\n[View details](${chatUrl})\n\nBest,\nMothership`

  const html = result.success
    ? renderEmailHtml(result.content, chatUrl)
    : renderErrorHtml(result.error || 'Unknown error', chatUrl)

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
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}

const EMAIL_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif; font-size: 15px; line-height: 25px; color: #1a1a1a; font-weight: 430; }
  p { margin: 0 0 16px 0; }
  h1, h2, h3, h4 { font-weight: 600; color: #1a1a1a; margin-top: 24px; margin-bottom: 12px; }
  h1 { font-size: 24px; } h2 { font-size: 20px; } h3 { font-size: 16px; } h4 { font-size: 15px; }
  strong { font-weight: 600; color: #1a1a1a; }
  pre { background: #f3f3f3; padding: 16px; border-radius: 8px; border: 1px solid #ededed; overflow-x: auto; margin: 24px 0; }
  code { background: #f3f3f3; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; font-size: 13px; color: #1a1a1a; }
  pre code { background: none; padding: 0; font-size: 13px; line-height: 21px; }
  table { border-collapse: collapse; margin: 16px 0; }
  th, td { border: 1px solid #ededed; padding: 8px 12px; text-align: left; font-size: 14px; }
  th { background: #f5f5f5; font-weight: 600; }
  tr { border-bottom: 1px solid #ededed; }
  blockquote { border-left: 4px solid #e0e0e0; margin: 16px 0; padding: 4px 16px; color: #525252; font-style: italic; }
  a { color: #2563eb; text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 2px; }
  ul, ol { margin: 16px 0; padding-left: 24px; }
  li { margin: 4px 0; }
  hr { border: none; border-top: 1px solid #ededed; margin: 24px 0; }
  .signature { color: #525252; margin-top: 32px; font-size: 14px; }
  .signature a { color: #1a1a1a; text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 2px; }
`

function stripRawHtml(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((segment, i) =>
      i % 2 === 0 ? replaceUntilStable(segment, /<\/?[a-z][^>]*>/gi, '') : segment
    )
    .join('')
}

function stripUnsafeUrls(html: string): string {
  return html.replace(/href\s*=\s*"(javascript|vbscript|data):[^"]*"/gi, 'href="#"')
}

function renderEmailHtml(markdown: string, chatUrl: string): string {
  const bodyHtml = stripUnsafeUrls(marked.parse(stripRawHtml(markdown), { async: false }) as string)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${EMAIL_STYLES}</style></head>
<body>
${bodyHtml}
<div class="signature">
  <p><a href="${escapeAttr(chatUrl)}">View full conversation</a></p>
  <p>Best,<br>Mothership</p>
</div>
</body></html>`
}

function renderErrorHtml(error: string, chatUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${EMAIL_STYLES}</style></head>
<body>
<p>I wasn't able to complete this task.</p>
<p style="color: #6b7280;">Error: ${escapeHtml(error)}</p>
<div class="signature">
  <p><a href="${escapeAttr(chatUrl)}">View details</a></p>
  <p>Best,<br>Mothership</p>
</div>
</body></html>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
