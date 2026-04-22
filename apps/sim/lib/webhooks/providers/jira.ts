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
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
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
    const {
      extractIssueData,
      extractCommentData,
      extractWorklogData,
      extractSprintData,
      extractProjectData,
      extractVersionData,
    } = await import('@/triggers/jira/utils')
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (
      triggerId === 'jira_issue_commented' ||
      triggerId === 'jira_comment_updated' ||
      triggerId === 'jira_comment_deleted'
    ) {
      return { input: extractCommentData(body) }
    }
    if (
      triggerId === 'jira_worklog_created' ||
      triggerId === 'jira_worklog_updated' ||
      triggerId === 'jira_worklog_deleted'
    ) {
      return { input: extractWorklogData(body) }
    }
    if (
      triggerId === 'jira_sprint_created' ||
      triggerId === 'jira_sprint_started' ||
      triggerId === 'jira_sprint_closed'
    ) {
      return { input: extractSprintData(body) }
    }
    if (triggerId === 'jira_project_created') {
      return { input: extractProjectData(body) }
    }
    if (triggerId === 'jira_version_released') {
      return { input: extractVersionData(body) }
    }

    if (!triggerId || triggerId === 'jira_webhook') {
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
          worklog: obj.worklog,
          sprint: obj.sprint,
          project: obj.project,
          version: obj.version,
        },
      }
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
    const comment = obj.comment as Record<string, unknown> | undefined
    const worklog = obj.worklog as Record<string, unknown> | undefined
    const project = obj.project as Record<string, unknown> | undefined
    const sprint = obj.sprint as Record<string, unknown> | undefined
    const version = obj.version as Record<string, unknown> | undefined
    const entityId =
      comment?.id || worklog?.id || issue?.id || project?.id || sprint?.id || version?.id
    if (obj.webhookEvent && entityId) {
      const ts = obj.timestamp ?? ''
      return `${obj.webhookEvent}:${entityId}:${ts}`
    }
    return null
  },
}
