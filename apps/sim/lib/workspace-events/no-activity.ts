import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, gt, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { SIM_RULE_COOLDOWN_HOURS, SIM_TRIGGER_PROVIDER } from '@/lib/workspace-events/constants'
import { dispatchSimEvent } from '@/lib/workspace-events/emitter'
import { buildNoActivityEventPayload } from '@/lib/workspace-events/payload'
import { excludeSimExecutionsCondition } from '@/lib/workspace-events/rules'
import { claimCooldown, isWithinCooldown, readLastFiredAt } from '@/lib/workspace-events/state'
import { parseSubscriptionConfig } from '@/lib/workspace-events/subscriptions'
import type { SimSubscription, SimSubscriptionConfig } from '@/lib/workspace-events/types'

const logger = createLogger('WorkspaceEventNoActivity')

/**
 * Page size for the keyset-paginated subscription scan. Every subscription is
 * visited each poll — pagination bounds memory, not total work.
 */
export const NO_ACTIVITY_SUBSCRIPTION_PAGE_SIZE = 500

/** Bound on watched workflows checked per subscription per poll. */
const MAX_WORKFLOWS_PER_SUBSCRIPTION = 500

export interface NoActivityPollResult {
  subscriptions: number
  checked: number
  fired: number
  skipped: number
}

/**
 * Fetches one page of deployed Sim-trigger subscriptions configured for
 * no_activity, across all workspaces, keyset-paginated by webhook id. A
 * fixed cap would silently starve subscriptions beyond it; paging visits
 * every subscription while keeping memory bounded. This runs from a
 * low-frequency cron, so a global paged scan is acceptable — unlike the hot
 * execution-completion path.
 */
async function fetchNoActivitySubscriptionPage(
  afterWebhookId: string | null
): Promise<SimSubscription[]> {
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
        ),
        afterWebhookId === null ? undefined : gt(webhook.id, afterWebhookId)
      )
    )
    .orderBy(asc(webhook.id))
    .limit(NO_ACTIVITY_SUBSCRIPTION_PAGE_SIZE)

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
  // Subscriber exclusion and the explicit selection must be SQL conditions:
  // filtering in memory after an unordered LIMIT could permanently drop an
  // explicitly watched workflow in workspaces above the cap. The ORDER BY
  // keeps the capped scan deterministic across polls.
  const conditions = [
    eq(workflow.workspaceId, workspaceId),
    eq(workflow.isDeployed, true),
    isNull(workflow.archivedAt),
    ne(workflow.id, subscriberWorkflowId),
  ]
  if (config.workflowIds.length > 0) {
    conditions.push(inArray(workflow.id, config.workflowIds))
  }

  return db
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(and(...conditions))
    .orderBy(asc(workflow.id))
    .limit(MAX_WORKFLOWS_PER_SUBSCRIPTION)
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
        gte(workflowExecutionLogs.startedAt, windowStart),
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
 * Checks a single no_activity subscription's watched workflows and fires
 * events for the inactive ones, accumulating counts into `result`.
 */
async function checkSubscription(
  subscription: SimSubscription,
  result: NoActivityPollResult
): Promise<void> {
  const config = parseSubscriptionConfig(subscription.webhook.providerConfig)
  if (!config || config.eventType !== 'no_activity') return

  const workspaceId = subscription.workflow.workspaceId
  if (!workspaceId) return

  const blockKey = subscription.webhook.blockId ?? subscription.webhook.path
  const cooldownMs = noActivityCooldownMs(config)

  const watched = await fetchWatchedWorkflows(workspaceId, subscription.webhook.workflowId, config)

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

/**
 * Checks every no_activity subscription and fires side-effect workflows for
 * watched workflows with no qualifying executions inside the window. The
 * subscription scan is keyset-paginated, so every subscription is visited
 * each poll regardless of how many exist.
 *
 * Cooldown state is keyed per (subscriber block × watched workflow), so one
 * inactive workflow never suppresses alerts for others — a deliberate fix
 * over the legacy per-subscription cooldown. A deployed workflow that has
 * never executed fires once, then respects the cooldown.
 */
export async function pollNoActivityEvents(): Promise<NoActivityPollResult> {
  const result: NoActivityPollResult = { subscriptions: 0, checked: 0, fired: 0, skipped: 0 }

  let cursor: string | null = null
  while (true) {
    const page = await fetchNoActivitySubscriptionPage(cursor)
    if (page.length === 0) break

    result.subscriptions += page.length
    cursor = page[page.length - 1].webhook.id

    for (const subscription of page) {
      await checkSubscription(subscription, result)
    }

    if (page.length < NO_ACTIVITY_SUBSCRIPTION_PAGE_SIZE) break
  }

  if (result.subscriptions === 0) return result

  logger.info(
    `no_activity poll completed: ${result.fired} fired, ${result.skipped} skipped of ${result.checked} checked`
  )

  return result
}
