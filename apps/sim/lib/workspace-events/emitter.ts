import { createLogger } from '@sim/logger'
import { getActiveWorkflowContext } from '@sim/platform-authz/workflow'
import { generateShortId } from '@sim/utils/id'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import {
  isSimRuleEventType,
  SIM_RULE_COOLDOWN_HOURS,
  SIM_TRIGGER_PROVIDER,
} from '@/lib/workspace-events/constants'
import {
  buildDeployEventPayload,
  buildExecutionEventPayload,
  buildUndeployEventPayload,
} from '@/lib/workspace-events/payload'
import { evaluateRule } from '@/lib/workspace-events/rules'
import { claimCooldown, isWithinCooldown, readLastFiredAt } from '@/lib/workspace-events/state'
import {
  fetchSimTriggerSubscriptions,
  parseSubscriptionConfig,
} from '@/lib/workspace-events/subscriptions'
import type {
  ExecutionEventContext,
  SimEventPayload,
  SimSubscription,
  SimSubscriptionConfig,
} from '@/lib/workspace-events/types'

const logger = createLogger('WorkspaceEventEmitter')

const SIM_RULE_COOLDOWN_MS = SIM_RULE_COOLDOWN_HOURS * 60 * 60 * 1000

/** Stable cooldown identity for a subscriber block, surviving redeploys. */
function subscriptionBlockKey(subscription: SimSubscription): string {
  return subscription.webhook.blockId ?? subscription.webhook.path
}

/**
 * Enqueues one side-effect workflow execution for a matched subscription.
 *
 * Routes through the shared polled-webhook pipeline, which provides admission
 * control, billing attribution, deployment checks, and queue-vs-inline
 * routing. The processor stack (executor, blocks) is imported lazily so this
 * module stays cheap for the execution logger to import.
 */
export async function dispatchSimEvent(
  subscription: SimSubscription,
  payload: SimEventPayload
): Promise<void> {
  const requestId = generateShortId()
  try {
    const { processPolledWebhookEvent } = await import('@/lib/webhooks/processor')
    const result = await processPolledWebhookEvent(
      subscription.webhook,
      subscription.workflow,
      payload,
      requestId
    )

    if (!result.success) {
      logger.error(
        `[${requestId}] Failed to fire sim trigger for workflow ${subscription.workflow.id}:`,
        result.statusCode,
        result.error
      )
    }
  } catch (error) {
    logger.error(
      `[${requestId}] Error firing sim trigger for workflow ${subscription.workflow.id}:`,
      error
    )
  }
}

/** Workflow-scope filter shared by all event kinds. Empty selection watches every workflow. */
function matchesWorkflowScope(config: SimSubscriptionConfig, sourceWorkflowId: string): boolean {
  if (config.workflowIds.length === 0) return true
  return config.workflowIds.includes(sourceWorkflowId)
}

/**
 * Emits workspace events for a completed workflow execution.
 *
 * Fire-and-forget: errors are logged and never thrown, so event emission can
 * never break the source execution. Executions started by the Sim trigger
 * itself never emit (loop prevention).
 */
export async function emitExecutionCompletedEvent(log: WorkflowExecutionLog): Promise<void> {
  try {
    if (!log.workflowId) return
    if (log.trigger === SIM_TRIGGER_PROVIDER) return

    const workflowContext = await getActiveWorkflowContext(log.workflowId)
    if (!workflowContext?.workspaceId) return

    const subscriptions = await fetchSimTriggerSubscriptions(workflowContext.workspaceId)
    if (subscriptions.length === 0) return

    const executionData = (log.executionData ?? {}) as Record<string, unknown>
    const context: ExecutionEventContext = {
      workflowId: log.workflowId,
      executionId: log.executionId,
      status: log.level === 'error' ? 'error' : 'success',
      durationMs: log.totalDurationMs || 0,
      cost: (log.cost as { total?: number } | undefined)?.total || 0,
      finalOutput: executionData.finalOutput,
    }

    for (const subscription of subscriptions) {
      const config = parseSubscriptionConfig(subscription.webhook.providerConfig)
      if (!config) continue
      if (config.eventType === 'workflow_deployed') continue
      // no_activity is owned by the inactivity poller and can never fire from
      // a completed execution; skip before the rule branch costs a cooldown
      // read on this hot path.
      if (config.eventType === 'no_activity') continue

      if (subscription.webhook.workflowId === log.workflowId) continue
      if (!matchesWorkflowScope(config, log.workflowId)) continue

      if (config.eventType === 'execution_success' && context.status !== 'success') continue
      if (config.eventType === 'execution_error' && context.status !== 'error') continue

      if (isSimRuleEventType(config.eventType)) {
        const blockKey = subscriptionBlockKey(subscription)

        const lastFiredAt = await readLastFiredAt(subscription.webhook.workflowId, blockKey, '')
        if (isWithinCooldown(lastFiredAt, SIM_RULE_COOLDOWN_MS)) continue

        const ruleFired = await evaluateRule(config.eventType, config, context)
        if (!ruleFired) continue

        const claimed = await claimCooldown(
          subscription.webhook.workflowId,
          blockKey,
          '',
          SIM_RULE_COOLDOWN_MS
        )
        if (!claimed) continue

        logger.info(`Sim trigger rule ${config.eventType} fired`, {
          subscriberWorkflowId: subscription.webhook.workflowId,
          sourceWorkflowId: log.workflowId,
          executionId: log.executionId,
        })
      }

      const payload = buildExecutionEventPayload({
        event: config.eventType as Parameters<typeof buildExecutionEventPayload>[0]['event'],
        workflowName: workflowContext.workflow.name,
        context,
      })

      await dispatchSimEvent(subscription, payload)
    }
  } catch (error) {
    logger.error('Failed to emit workspace execution event', {
      error,
      workflowId: log.workflowId,
      executionId: log.executionId,
    })
  }
}

/**
 * Shared dispatch loop for workflow lifecycle events: matches subscriptions
 * on event type and workflow scope, never notifying the source workflow about
 * itself. Fire-and-forget: failures never affect the lifecycle operation.
 */
async function emitWorkflowLifecycleEvent(params: {
  eventType: 'workflow_deployed' | 'workflow_undeployed'
  workflowId: string
  workspaceId: string
  payload: SimEventPayload
}): Promise<void> {
  try {
    const subscriptions = await fetchSimTriggerSubscriptions(params.workspaceId)
    if (subscriptions.length === 0) return

    for (const subscription of subscriptions) {
      const config = parseSubscriptionConfig(subscription.webhook.providerConfig)
      if (!config) continue
      if (config.eventType !== params.eventType) continue

      if (subscription.webhook.workflowId === params.workflowId) continue
      if (!matchesWorkflowScope(config, params.workflowId)) continue

      await dispatchSimEvent(subscription, params.payload)
    }
  } catch (error) {
    logger.error(`Failed to emit ${params.eventType} event`, {
      error,
      workflowId: params.workflowId,
    })
  }
}

/**
 * Emits a workflow_deployed event to subscribed side-effect workflows.
 *
 * Fired on any deployment activation (fresh deploy, redeploy, version
 * rollback/activation). Fire-and-forget: failures never affect the deploy.
 */
export async function emitWorkflowDeployedEvent(params: {
  workflowId: string
  workflowName: string
  workspaceId: string
  version: number | null
}): Promise<void> {
  await emitWorkflowLifecycleEvent({
    eventType: 'workflow_deployed',
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
    payload: buildDeployEventPayload({
      workflowId: params.workflowId,
      workflowName: params.workflowName,
      version: params.version,
    }),
  })
}

/**
 * Emits a workflow_undeployed event to subscribed side-effect workflows.
 *
 * Fired when a workflow is taken offline. Fire-and-forget: failures never
 * affect the undeploy.
 */
export async function emitWorkflowUndeployedEvent(params: {
  workflowId: string
  workflowName: string
  workspaceId: string
}): Promise<void> {
  await emitWorkflowLifecycleEvent({
    eventType: 'workflow_undeployed',
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
    payload: buildUndeployEventPayload({
      workflowId: params.workflowId,
      workflowName: params.workflowName,
    }),
  })
}
