import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import {
  SIM_EVENT_TYPES,
  SIM_RULE_DEFAULTS,
  SIM_TRIGGER_PROVIDER,
  type SimEventType,
} from '@/lib/workspace-events/constants'
import type { SimSubscription, SimSubscriptionConfig } from '@/lib/workspace-events/types'

/**
 * Fetches active Sim-trigger subscriptions for one workspace.
 *
 * Workspace-scoped on purpose: execution completion is the hottest event in
 * the platform, so this must never degrade into a global provider scan. The
 * deployment-version join enforces that subscribers are deployed and the
 * webhook row belongs to the active deployment version.
 */
export async function fetchSimTriggerSubscriptions(
  workspaceId: string
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
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  return rows
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  }
  if (typeof value === 'string' && value.length > 0) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

/**
 * Parses a webhook row's providerConfig into a typed subscription config.
 * Returns null when the config has no recognizable event type.
 */
export function parseSubscriptionConfig(providerConfig: unknown): SimSubscriptionConfig | null {
  const config =
    providerConfig && typeof providerConfig === 'object' && !Array.isArray(providerConfig)
      ? (providerConfig as Record<string, unknown>)
      : {}

  const eventType = config.eventType
  if (
    typeof eventType !== 'string' ||
    !(SIM_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    return null
  }

  return {
    eventType: eventType as SimEventType,
    workflowIds: parseStringArray(config.workflowIds),
    consecutiveFailures: parsePositiveNumber(
      config.consecutiveFailures,
      SIM_RULE_DEFAULTS.consecutiveFailures
    ),
    failureRatePercent: parsePositiveNumber(
      config.failureRatePercent,
      SIM_RULE_DEFAULTS.failureRatePercent
    ),
    windowHours: parsePositiveNumber(config.windowHours, SIM_RULE_DEFAULTS.windowHours),
    durationThresholdMs: parsePositiveNumber(
      config.durationThresholdMs,
      SIM_RULE_DEFAULTS.durationThresholdMs
    ),
    latencySpikePercent: parsePositiveNumber(
      config.latencySpikePercent,
      SIM_RULE_DEFAULTS.latencySpikePercent
    ),
    costThresholdCredits: parsePositiveNumber(
      config.costThresholdCredits,
      SIM_RULE_DEFAULTS.costThresholdCredits
    ),
    errorCountThreshold: parsePositiveNumber(
      config.errorCountThreshold,
      SIM_RULE_DEFAULTS.errorCountThreshold
    ),
    inactivityHours: parsePositiveNumber(config.inactivityHours, SIM_RULE_DEFAULTS.inactivityHours),
  }
}
