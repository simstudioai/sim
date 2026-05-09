import { type ComponentType, type CSSProperties, createElement, type ReactNode } from 'react'
import { Body, Head, Html, Link, Markdown, Section, Text } from '@react-email/components'
import { render } from '@react-email/render'
import { createLogger } from '@sim/logger'
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
    ? await renderEmailHtml(result.content, chatUrl)
    : await renderErrorHtml(result.error || 'Unknown error', chatUrl)

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

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif"
const CODE_FONT_FAMILY = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"

const emailStyles = {
  body: {
    fontFamily: FONT_FAMILY,
    fontSize: '15px',
    lineHeight: '25px',
    color: '#1a1a1a',
    fontWeight: 430,
  },
  content: {
    margin: 0,
  },
  markdownContainer: {
    margin: 0,
  },
  signature: {
    color: '#525252',
    marginTop: '32px',
    fontSize: '14px',
  },
  signatureText: {
    color: '#525252',
    margin: '0 0 16px 0',
    fontSize: '14px',
    lineHeight: '25px',
    fontFamily: FONT_FAMILY,
  },
  signatureLink: {
    color: '#1a1a1a',
    textDecoration: 'underline',
    textDecorationStyle: 'dashed',
    textUnderlineOffset: '2px',
  },
} satisfies Record<string, CSSProperties>

const markdownStyles = {
  p: {
    margin: '0 0 16px 0',
    fontSize: '15px',
    lineHeight: '25px',
    color: '#1a1a1a',
    fontFamily: FONT_FAMILY,
    fontWeight: 430,
  },
  h1: {
    fontWeight: 600,
    color: '#1a1a1a',
    margin: '24px 0 12px 0',
    fontSize: '24px',
    lineHeight: '32px',
    fontFamily: FONT_FAMILY,
  },
  h2: {
    fontWeight: 600,
    color: '#1a1a1a',
    margin: '24px 0 12px 0',
    fontSize: '20px',
    lineHeight: '28px',
    fontFamily: FONT_FAMILY,
  },
  h3: {
    fontWeight: 600,
    color: '#1a1a1a',
    margin: '24px 0 12px 0',
    fontSize: '16px',
    lineHeight: '24px',
    fontFamily: FONT_FAMILY,
  },
  h4: {
    fontWeight: 600,
    color: '#1a1a1a',
    margin: '24px 0 12px 0',
    fontSize: '15px',
    lineHeight: '25px',
    fontFamily: FONT_FAMILY,
  },
  strong: {
    fontWeight: 600,
    color: '#1a1a1a',
  },
  codeInline: {
    backgroundColor: '#f3f3f3',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: CODE_FONT_FAMILY,
    fontSize: '13px',
    color: '#1a1a1a',
  },
  codeBlock: {
    backgroundColor: '#f3f3f3',
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #ededed',
    overflowX: 'auto',
    margin: '24px 0',
    fontFamily: CODE_FONT_FAMILY,
    fontSize: '13px',
    lineHeight: '21px',
    color: '#1a1a1a',
  },
  table: {
    borderCollapse: 'collapse',
    margin: '16px 0',
  },
  th: {
    border: '1px solid #ededed',
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: '14px',
    backgroundColor: '#f5f5f5',
    fontWeight: 600,
  },
  td: {
    border: '1px solid #ededed',
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: '14px',
  },
  blockQuote: {
    borderLeft: '4px solid #e0e0e0',
    margin: '16px 0',
    padding: '4px 16px',
    color: '#525252',
    fontStyle: 'italic',
  },
  a: {
    color: '#2563eb',
    textDecoration: 'underline',
    textDecorationStyle: 'dashed',
    textUnderlineOffset: '2px',
  },
  ul: {
    margin: '16px 0',
    paddingLeft: '24px',
  },
  ol: {
    margin: '16px 0',
    paddingLeft: '24px',
  },
  li: {
    margin: '4px 0',
  },
  hr: {
    border: 'none',
    borderTop: '1px solid #ededed',
    margin: '24px 0',
  },
} satisfies Record<string, CSSProperties>

interface InboxResponseEmailProps {
  children?: ReactNode
  chatUrl: string
  linkLabel: string
}

interface EmailMarkdownProps {
  children?: string
  markdownContainerStyles?: CSSProperties
  markdownCustomStyles?: Record<string, CSSProperties>
}

const EmailMarkdown = Markdown as ComponentType<EmailMarkdownProps>

function InboxResponseEmail({ children, chatUrl, linkLabel }: InboxResponseEmailProps) {
  return createElement(
    Html,
    { lang: 'en', dir: 'ltr' },
    createElement(Head),
    createElement(
      Body,
      { style: emailStyles.body },
      createElement(Section, { style: emailStyles.content }, children),
      createElement(
        Section,
        { style: emailStyles.signature },
        createElement(
          Text,
          { style: emailStyles.signatureText },
          createElement(Link, { href: chatUrl, style: emailStyles.signatureLink }, linkLabel)
        ),
        createElement(
          Text,
          { style: emailStyles.signatureText },
          'Best,',
          createElement('br'),
          'Mothership'
        )
      )
    )
  )
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

function stripUnsafeUrls(html: string): string {
  return html.replace(/href\s*=\s*(['"])(?:javascript|vbscript|data):.*?\1/gi, 'href="#"')
}

async function renderEmailHtml(markdown: string, chatUrl: string): Promise<string> {
  const safeMarkdown = preserveSoftBreaks(stripRawHtml(markdown))
  const html = await render(
    createElement(
      InboxResponseEmail,
      { chatUrl, linkLabel: 'View full conversation' },
      createElement(
        EmailMarkdown,
        {
          markdownContainerStyles: emailStyles.markdownContainer,
          markdownCustomStyles: markdownStyles,
        },
        safeMarkdown
      )
    )
  )

  return stripUnsafeUrls(html)
}

async function renderErrorHtml(error: string, chatUrl: string): Promise<string> {
  const html = await render(
    createElement(
      InboxResponseEmail,
      { chatUrl, linkLabel: 'View details' },
      createElement(
        Text,
        { key: 'message', style: markdownStyles.p },
        "I wasn't able to complete this task."
      ),
      createElement(
        Text,
        { key: 'error', style: { ...markdownStyles.p, color: '#6b7280' } },
        `Error: ${error}`
      )
    )
  )

  return stripUnsafeUrls(html)
}
