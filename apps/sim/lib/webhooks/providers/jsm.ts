import { createLogger } from '@sim/logger'
import { validateJiraSignature } from '@/lib/webhooks/providers/jira'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:JSM')

/**
 * Jira Service Management webhook handler.
 *
 * JSM uses the Jira webhook infrastructure. The handler reuses the same HMAC
 * signature validation as Jira and adds JSM-specific event matching logic
 * to route events to the correct trigger based on event type and changelog context.
 */
export const jsmHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Hub-Signature',
    validateFn: validateJiraSignature,
    providerLabel: 'JSM',
  }),

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const { extractRequestData, extractCommentData } = await import('@/triggers/jsm/utils')
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'jsm_request_commented') {
      return { input: extractCommentData(body as Record<string, unknown>) }
    }

    // For the generic webhook, pass through the full payload so no data is lost
    if (!triggerId || triggerId === 'jsm_webhook') {
      const obj = body as Record<string, unknown>
      return {
        input: {
          webhookEvent: obj.webhookEvent,
          timestamp: obj.timestamp,
          user: obj.user || null,
          issue_event_type_name: obj.issue_event_type_name,
          issue: obj.issue || {},
          changelog: obj.changelog,
          comment: obj.comment,
        },
      }
    }

    return { input: extractRequestData(body as Record<string, unknown>) }
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== 'jsm_webhook') {
      const webhookEvent = obj.webhookEvent as string | undefined
      const issueEventTypeName = obj.issue_event_type_name as string | undefined
      const changelog = obj.changelog as
        | { items?: Array<{ field?: string; toString?: string }> }
        | undefined

      const { isJsmEventMatch } = await import('@/triggers/jsm/utils')
      if (!isJsmEventMatch(triggerId, webhookEvent || '', issueEventTypeName, changelog)) {
        logger.debug(
          `[${requestId}] JSM event mismatch for trigger ${triggerId}. Event: ${webhookEvent}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: webhookEvent,
          }
        )
        return false
      }
    }

    return true
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const comment = obj.comment as Record<string, unknown> | undefined
    const issue = obj.issue as Record<string, unknown> | undefined
    const entityId = comment?.id || issue?.id
    if (obj.webhookEvent && entityId) {
      const ts = obj.timestamp ?? ''
      return `jsm:${obj.webhookEvent}:${entityId}:${ts}`
    }
    return null
  },
}
