import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { SIM_RULE_COOLDOWN_HOURS, SIM_TRIGGER_PROVIDER } from '@/lib/workspace-events/constants'
import { dispatchSimEvent } from '@/lib/workspace-events/emitter'
import { buildNoActivityEventPayload } from '@/lib/workspace-events/payload'
import { excludeSimExecutionsCondition } from '@/lib/workspace-events/rules'
import { claimCooldown, isWithinCooldown, readLastFiredAt } from '@/lib/workspace-events/state'
import { parseSubscriptionConfig } from '@/lib/workspace-events/subscriptions'
import type { SimSubscription, SimSubscriptionConfig } from '@/lib/workspace-events/types'

const logger = createLogger('WorkspaceEventNoActivity')

/** Bound on subscriptions scanned per poll. */
const MAX_SUBSCRIPTIONS_PER_POLL = 500

/** Bound on watched workflows checked per subscription per poll. */
const MAX_WORKFLOWS_PER_SUBSCRIPTION = 500

export interface NoActivityPollResult {
  subscriptions: number
  checked: number
  fired: number
  skipped: number
}

/**
 * Fetches deployed Sim-trigger subscriptions configured for no_activity,
 * across all workspaces. This runs from a low-frequency cron, so a global
 * (bounded) scan is acceptable — unlike the hot execution-completion path.
 */
async function fetchNoActivitySubscriptions(): Promise<SimSubscription[]> {
  const rows = await db
    .select({ webhook, workflow })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, workflow.id),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.provider, SIM_TRIGGER_PROVIDER),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        sql`${webhook.providerConfig}->>'eventType' = 'no_activity'`,
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )
    .limit(MAX_SUBSCRIPTIONS_PER_POLL)

  return rows
}

/**
 * Resolves the workflows a no_activity subscription watches: deployed, active
 * workflows in the subscriber's workspace, minus the subscriber itself,
 * narrowed to the explicit selection when one is set (empty selection watches
 * everything). Deployed-only keeps never-runnable draft workflows from
 * alerting forever.
 */
async function fetchWatchedWorkflows(
  workspaceId: string,
  subscriberWorkflowId: string,
  config: SimSubscriptionConfig
): Promise<Array<{ id: string; name: string }>> {
  const rows = await db
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt)
      )
    )
    .limit(MAX_WORKFLOWS_PER_SUBSCRIPTION)

  return rows.filter((candidate) => {
    if (candidate.id === subscriberWorkflowId) return false
    if (config.workflowIds.length > 0 && !config.workflowIds.includes(candidate.id)) return false
    return true
  })
}

/** True when the workflow had at least one qualifying execution inside the window. */
async function hasRecentActivity(
  workflowId: string,
  config: SimSubscriptionConfig
): Promise<boolean> {
  const windowStart = new Date(Date.now() - config.inactivityHours * 60 * 60 * 1000)

  const recentLogs = await db
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        gte(workflowExecutionLogs.createdAt, windowStart),
        excludeSimExecutionsCondition()
      )
    )
    .limit(1)

  return recentLogs.length > 0
}

/**
 * Cooldown for no_activity firings. At least the inactivity window itself —
 * an hour-long cooldown with a multi-hour window would re-alert every hour
 * for the same ongoing inactivity.
 */
function noActivityCooldownMs(config: SimSubscriptionConfig): number {
  return Math.max(SIM_RULE_COOLDOWN_HOURS, config.inactivityHours) * 60 * 60 * 1000
}

/**
 * Checks every no_activity subscription and fires side-effect workflows for
 * watched workflows with no qualifying executions inside the window.
 *
 * Cooldown state is keyed per (subscriber block × watched workflow), so one
 * inactive workflow never suppresses alerts for others — a deliberate fix
 * over the legacy per-subscription cooldown. A deployed workflow that has
 * never executed fires once, then respects the cooldown.
 */
export async function pollNoActivityEvents(): Promise<NoActivityPollResult> {
  const result: NoActivityPollResult = { subscriptions: 0, checked: 0, fired: 0, skipped: 0 }

  const subscriptions = await fetchNoActivitySubscriptions()
  result.subscriptions = subscriptions.length
  if (subscriptions.length === 0) return result

  if (subscriptions.length >= MAX_SUBSCRIPTIONS_PER_POLL) {
    logger.warn(`no_activity subscription scan hit the ${MAX_SUBSCRIPTIONS_PER_POLL} cap`)
  }

  for (const subscription of subscriptions) {
    const config = parseSubscriptionConfig(subscription.webhook.providerConfig)
    if (!config || config.eventType !== 'no_activity') continue

    const workspaceId = subscription.workflow.workspaceId
    if (!workspaceId) continue

    const blockKey = subscription.webhook.blockId ?? subscription.webhook.path
    const cooldownMs = noActivityCooldownMs(config)

    const watched = await fetchWatchedWorkflows(
      workspaceId,
      subscription.webhook.workflowId,
      config
    )

    for (const sourceWorkflow of watched) {
      result.checked++

      const lastFiredAt = await readLastFiredAt(
        subscription.webhook.workflowId,
        blockKey,
        sourceWorkflow.id
      )
      if (isWithinCooldown(lastFiredAt, cooldownMs)) {
        result.skipped++
        continue
      }

      if (await hasRecentActivity(sourceWorkflow.id, config)) {
        result.skipped++
        continue
      }

      const claimed = await claimCooldown(
        subscription.webhook.workflowId,
        blockKey,
        sourceWorkflow.id,
        cooldownMs
      )
      if (!claimed) {
        result.skipped++
        continue
      }

      const payload = buildNoActivityEventPayload({
        workflowId: sourceWorkflow.id,
        workflowName: sourceWorkflow.name,
      })

      await dispatchSimEvent(subscription, payload)
      result.fired++

      logger.info(`no_activity event fired for workflow ${sourceWorkflow.id}`, {
        subscriberWorkflowId: subscription.webhook.workflowId,
        inactivityHours: config.inactivityHours,
      })
    }
  }

  logger.info(
    `no_activity poll completed: ${result.fired} fired, ${result.skipped} skipped of ${result.checked} checked`
  )

  return result
}
