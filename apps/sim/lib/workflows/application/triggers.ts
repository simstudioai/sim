import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { Cron } from 'croner'
import { capabilityGovernedPrincipalUserId } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'
import { requireMutableWorkflow } from '@/lib/workflows/application/mutability'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  assertedWorkflowWorkspaceId,
  resolvePrincipalWorkflowContext,
} from '@/lib/workflows/application/principal-scope'
import {
  findLiveWorkflowTrigger,
  findTriggerRowOwner,
  type LiveWorkflowTriggerRecord,
  listLiveWorkflowTriggers,
  setLiveScheduleEnabled,
  setLiveWebhookEnabled,
  toWorkflowTriggerHealth,
  type WorkflowTriggerHealth,
  type WorkflowTriggerStatus,
} from '@/lib/workflows/triggers/health'

const TRIGGER_NOT_FOUND = 'Trigger not found'

interface ListWorkflowTriggersInput {
  workflowId: string
  assertedWorkspaceId?: string
}

/** Every trigger the live deployment serves, disabled ones included; empty when undeployed. */
export const listWorkflowTriggers = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readTriggers,
  resolveContext: resolvePrincipalWorkflowContext<ListWorkflowTriggersInput>,
  async execute({ context }) {
    const records = await listLiveWorkflowTriggers(context.workflowId)
    return { triggers: records.map(toWorkflowTriggerHealth) }
  },
})

/**
 * Which trigger to switch. Public callers name a block of the live deployment;
 * the legacy editor routes still name a row id, which is resolved to its block
 * and must itself be the live row — a row of an older version, or a registration
 * that is not active, answers not found rather than being revived.
 */
type WorkflowTriggerTarget =
  | { kind: 'block'; workflowId: string; blockId: string; assertedWorkspaceId?: string }
  | { kind: 'schedule_row'; scheduleId: string }
  | { kind: 'webhook_row'; webhookId: string }

interface SetWorkflowTriggerEnabledInput {
  target: WorkflowTriggerTarget
  enabled: boolean
}

interface TriggerTargetContext extends ActiveWorkflowApplicationContext {
  blockId: string
  row?: { table: LiveWorkflowTriggerRecord['table']; id: string }
  notFoundMessage: string
}

interface SetWorkflowTriggerEnabledResult {
  trigger: WorkflowTriggerHealth
  record: LiveWorkflowTriggerRecord
  changed: boolean
  previousStatus: WorkflowTriggerStatus
}

async function resolveTriggerTargetContext({
  principal,
  input,
}: {
  principal: Principal
  input: SetWorkflowTriggerEnabledInput
}): Promise<TriggerTargetContext> {
  const { target } = input
  if (target.kind === 'block') {
    const workflowContext = await resolveActiveWorkflowApplicationContext({
      workflowId: target.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, target.assertedWorkspaceId),
    })
    return { ...workflowContext, blockId: target.blockId, notFoundMessage: TRIGGER_NOT_FOUND }
  }

  const table = target.kind === 'schedule_row' ? 'schedule' : 'webhook'
  const notFoundMessage = table === 'schedule' ? 'Schedule not found' : 'Webhook not found'
  const row = await findTriggerRowOwner(
    table,
    target.kind === 'schedule_row' ? target.scheduleId : target.webhookId
  )
  if (!row) throw new OrchestrationError('not_found', notFoundMessage)
  if (!row.workflowId) {
    throw new OrchestrationError('validation', 'Schedule has no associated workflow')
  }
  if (!row.blockId) throw new OrchestrationError('not_found', notFoundMessage)
  const workflowContext = await resolveActiveWorkflowApplicationContext({
    workflowId: row.workflowId,
  })
  return {
    ...workflowContext,
    blockId: row.blockId,
    row: { table, id: row.id },
    notFoundMessage,
  }
}

/**
 * The run a re-enabled schedule is armed for. A completed schedule may come
 * back only while its cron still has a run ahead of it — and before its end
 * boundary — or it would complete again on the next tick.
 */
function nextScheduledRun(
  row: Extract<LiveWorkflowTriggerRecord, { table: 'schedule' }>['row']
): Date {
  if (!row.cronExpression) {
    throw new OrchestrationError('validation', 'Schedule has no cron expression')
  }
  let cron: Cron
  try {
    cron = new Cron(row.cronExpression, { timezone: row.timezone || 'UTC' })
  } catch {
    throw new OrchestrationError('validation', 'Schedule has invalid cron expression')
  }
  const nextRun = cron.nextRun()
  if (!nextRun || (row.endsAt && nextRun > row.endsAt)) {
    throw new OrchestrationError(
      'conflict',
      'Schedule has no future runs; change its schedule and redeploy'
    )
  }
  return nextRun
}

/**
 * permission-group-enforced: triggers.webhook — enabling a dormant webhook row
 * makes the workflow reachable again exactly as creating it would, so it is
 * gated here, where the row's table is known. Only this direction: disabling
 * must stay open, or a policy change would strand a member with a live webhook
 * they cannot switch off. Keyed to the governed subject, so a workspace key —
 * which no group governs — is not judged against its creator's group.
 */
async function assertWebhookEnableAllowed(
  principal: Principal,
  context: TriggerTargetContext
): Promise<void> {
  const governedUserId = capabilityGovernedPrincipalUserId(principal)
  if (!governedUserId) return
  await assertWorkspaceCapability(
    governedUserId,
    context.workspaceId,
    'triggers.webhook',
    context.workspaceOrganizationId
  )
}

async function readLiveTarget(
  context: TriggerTargetContext
): Promise<LiveWorkflowTriggerRecord | null> {
  const record = await findLiveWorkflowTrigger({
    workflowId: context.workflowId,
    blockId: context.blockId,
    rowId: context.row?.id,
  })
  if (!record || (context.row && record.table !== context.row.table)) return null
  return record
}

/**
 * Pauses or resumes one trigger of the live deployment without redeploying.
 *
 * Enabling resets the failure counters, re-arms a schedule's next run, and
 * clears a poller's backoff. Disabling only closes Sim's gate: nothing is torn
 * down at the provider. A request for the state the trigger is already in
 * changes nothing and records no audit.
 */
export const setWorkflowTriggerEnabled = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.setTriggerEnabled,
  resolveContext: resolveTriggerTargetContext,
  async execute({ principal, input, context }): Promise<SetWorkflowTriggerEnabledResult> {
    await requireMutableWorkflow(context.workflowId)
    const current = await readLiveTarget(context)
    if (!current) throw new OrchestrationError('not_found', context.notFoundMessage)
    const before = toWorkflowTriggerHealth(current)
    if (before.enabled === input.enabled) {
      return { trigger: before, record: current, changed: false, previousStatus: before.status }
    }

    const now = new Date()
    let updated: LiveWorkflowTriggerRecord | null
    if (current.table === 'schedule') {
      updated = await setLiveScheduleEnabled({
        workflowId: context.workflowId,
        scheduleId: current.row.id,
        enabled: input.enabled,
        nextRunAt: input.enabled ? nextScheduledRun(current.row) : null,
        now,
      })
    } else {
      if (input.enabled) await assertWebhookEnableAllowed(principal, context)
      updated = await setLiveWebhookEnabled({
        workflowId: context.workflowId,
        webhookId: current.row.id,
        enabled: input.enabled,
        now,
      })
    }

    if (updated) {
      return {
        trigger: toWorkflowTriggerHealth(updated),
        record: updated,
        changed: true,
        previousStatus: before.status,
      }
    }

    const latest = await readLiveTarget(context)
    if (!latest) throw new OrchestrationError('not_found', context.notFoundMessage)
    const latestTrigger = toWorkflowTriggerHealth(latest)
    if (latestTrigger.enabled !== input.enabled) {
      throw new OrchestrationError('conflict', 'Trigger changed during the update; retry')
    }
    return {
      trigger: latestTrigger,
      record: latest,
      changed: false,
      previousStatus: before.status,
    }
  },
  projectAudit: ({ input, result, context }) => {
    if (!result.changed) return []
    const verb = input.enabled ? 'Enabled' : 'Disabled'
    const shared = {
      workflowId: context.workflowId,
      blockId: result.trigger.blockId,
      enabled: input.enabled,
      previousStatus: result.previousStatus,
    }
    if (result.record.table === 'schedule') {
      const { row } = result.record
      return {
        action: AuditAction.SCHEDULE_UPDATED,
        resourceType: AuditResourceType.SCHEDULE,
        resourceId: row.id,
        resourceName: row.jobTitle ?? undefined,
        description: `${verb} schedule "${row.jobTitle ?? row.id}"`,
        metadata: {
          ...shared,
          sourceType: row.sourceType,
          cronExpression: row.cronExpression,
          timezone: row.timezone,
        },
      }
    }
    const provider = result.record.row.provider || 'generic'
    return {
      action: AuditAction.WEBHOOK_UPDATED,
      resourceType: AuditResourceType.WEBHOOK,
      resourceId: result.record.row.id,
      resourceName: provider,
      description: `${verb} ${provider} webhook`,
      metadata: { ...shared, provider },
    }
  },
})
