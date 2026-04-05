import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Jira')

export function validateJiraSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Jira signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    if (!signature.startsWith('sha256=')) {
      logger.warn('Jira signature has invalid format (expected sha256=)', {
        signaturePrefix: signature.substring(0, 10),
      })
      return false
    }
    const providedSignature = signature.substring(7)
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    logger.debug('Jira signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Jira signature:', error)
    return false
  }
}

export const jiraHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Hub-Signature',
    validateFn: validateJiraSignature,
    providerLabel: 'Jira',
  }),

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const { extractIssueData, extractCommentData, extractWorklogData } = await import(
      '@/triggers/jira/utils'
    )
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId === 'jira_issue_commented') {
      return { input: extractCommentData(body) }
    }
    if (triggerId === 'jira_worklog_created') {
      return { input: extractWorklogData(body) }
    }
    return { input: extractIssueData(body) }
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== 'jira_webhook') {
      const webhookEvent = obj.webhookEvent as string | undefined
      const issueEventTypeName = obj.issue_event_type_name as string | undefined

      const { isJiraEventMatch } = await import('@/triggers/jira/utils')
      if (!isJiraEventMatch(triggerId, webhookEvent || '', issueEventTypeName)) {
        logger.debug(
          `[${requestId}] Jira event mismatch for trigger ${triggerId}. Event: ${webhookEvent}. Skipping execution.`,
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
    const issue = obj.issue as Record<string, unknown> | undefined
    const project = obj.project as Record<string, unknown> | undefined
    if (obj.webhookEvent && (issue?.id || project?.id)) {
      return `${obj.webhookEvent}:${issue?.id || project?.id}`
    }
    return null
  },
}
