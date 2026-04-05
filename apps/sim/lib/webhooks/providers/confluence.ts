import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { validateJiraSignature } from '@/lib/webhooks/providers/jira'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Confluence')

export const confluenceHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Hub-Signature',
    validateFn: validateJiraSignature,
    providerLabel: 'Confluence',
  }),

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const {
      extractPageData,
      extractCommentData,
      extractBlogData,
      extractAttachmentData,
      extractSpaceData,
      extractLabelData,
    } = await import('@/triggers/confluence/utils')
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId?.startsWith('confluence_comment_')) {
      return { input: extractCommentData(body) }
    }
    if (triggerId?.startsWith('confluence_blog_')) {
      return { input: extractBlogData(body) }
    }
    if (triggerId?.startsWith('confluence_attachment_')) {
      return { input: extractAttachmentData(body) }
    }
    if (triggerId?.startsWith('confluence_space_')) {
      return { input: extractSpaceData(body) }
    }
    if (triggerId?.startsWith('confluence_label_')) {
      return { input: extractLabelData(body) }
    }
    if (triggerId === 'confluence_webhook') {
      const b = body as Record<string, unknown>
      return {
        input: {
          timestamp: b.timestamp,
          userAccountId: b.userAccountId,
          accountType: b.accountType,
          page: b.page || null,
          comment: b.comment || null,
          blog: b.blog || (b as Record<string, unknown>).blogpost || null,
          attachment: b.attachment || null,
          space: b.space || null,
          label: b.label || null,
          content: b.content || null,
        },
      }
    }
    return { input: extractPageData(body) }
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId) {
      const { isConfluencePayloadMatch } = await import('@/triggers/confluence/utils')
      if (!isConfluencePayloadMatch(triggerId, obj)) {
        logger.debug(
          `[${requestId}] Confluence payload mismatch for trigger ${triggerId}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            bodyKeys: Object.keys(obj),
          }
        )
        return NextResponse.json({
          message: 'Payload does not match trigger configuration. Ignoring.',
        })
      }
    }

    return true
  },
}
