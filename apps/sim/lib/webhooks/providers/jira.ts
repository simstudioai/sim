import { createLogger } from '@sim/logger'
import type { EventMatchContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateJiraSignature } from '@/lib/webhooks/utils.server'

const logger = createLogger('WebhookProvider:Jira')

export const jiraHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Hub-Signature',
    validateFn: validateJiraSignature,
    providerLabel: 'Jira',
  }),

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
