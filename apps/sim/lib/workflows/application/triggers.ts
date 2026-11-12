import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
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
import { validateCronExpression } from '@/lib/workflows/schedules/utils'
import {
  findLiveBlockTriggers,
  findTriggerRowOwner,
  isInRequestedState,
  type LiveWorkflowTriggerRecord,
  listLiveWorkflowTriggers,
  listWorkspaceLiveSchedulesPage,
  setLiveTriggersEnabled,
  type TriggerLiveness,
  toWorkflowTriggerHealth,
  type WorkflowTriggerHealth,
  type WorkflowTriggerStatus,
} from '@/lib/workflows/triggers/health'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

const TRIGGER_NOT_FOUND = 'Trigger not found'

interface ListWorkflowTriggersInput {
  workflowId: string
  assertedWorkspaceId?: string
}

/** Every trigger the live deployment serves, disabled ones included. */
export const listWorkflowTriggers = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readTriggers,
  resolveContext: resolvePrincipalWorkflowContext<ListWorkflowTriggersInput>,
  async execute({ context }) {
    const records = await listLiveWorkflowTriggers(context.workflowId)
    return { triggers: records.map(toWorkflowTriggerHealth) }
  },
})

type ListWorkspaceSchedulesInput = Parameters<typeof listWorkspaceLiveSchedulesPage>[0]

/**
 * Every schedule the workspace's deployed workflows run, disabled ones
 * included, one keyset page at a time. The same rows and the same read
 * authorization as {@link listWorkflowTriggers}, across the workspace instead
 * of one workflow.
 */
export const listWorkspaceSchedules = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readTriggers,
  resolveContext: ({ input }: { input: ListWorkspaceSchedulesInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ input, context }) {
    const page = await listWorkspaceLiveSchedulesPage({
      ...input,
      workspaceId: context.workspaceId,
    })
    return { schedules: page.data, nextCursorKeys: page.nextCursorKeys }
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
  | { kind: 'row'; table: LiveWorkflowTriggerRecord['table']; id: string }

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
  /** The target after the update; for a block with several live rows, the one the editor shows. */
  trigger: WorkflowTriggerHealth
  record: LiveWorkflowTriggerRecord
  /** Every row this request switched; empty when all were already in the requested state. */
  changes: { record: LiveWorkflowTriggerRecord; previousStatus: WorkflowTriggerStatus }[]
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

  const { table } = target
  const notFoundMessage = table === 'schedule' ? 'Schedule not found' : 'Webhook not found'
  const row = await findTriggerRowOwner(table, target.id)
  // A row with no workflow or block is never switchable, and answering before the tenant check
  // must not tell a caller anything beyond what a missing row would.
  if (!row?.workflowId || !row.blockId) throw new OrchestrationError('not_found', notFoundMessage)
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

/** The run a re-enabled schedule is armed for, refused when its cron has none ahead. */
function nextScheduledRun(
  row: Extract<LiveWorkflowTriggerRecord, { table: 'schedule' }>['row']
): Date {
  if (!row.cronExpression) {
    throw new OrchestrationError('validation', 'Schedule has no cron expression')
  }
  const cron = validateCronExpression(row.cronExpression, row.timezone || 'UTC')
  if (!cron.isValid || !cron.nextRun) {
    throw new OrchestrationError('validation', 'Schedule has invalid cron expression')
  }
  return cron.nextRun
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

/**
 * Pauses or resumes one trigger of the live deployment without redeploying.
 * A block target switches every live row of the block together; a legacy row
 * target switches exactly that row.
 *
 * Enabling resets the failure counters, re-arms a schedule's next run, and
 * clears a poller's backoff. Disabling only closes Sim's gate: nothing is torn
 * down at the provider. A request for the state the trigger is already in
 * changes nothing and records no audit. A disable lasts until the next deploy
 * or version activation, which re-registers every trigger enabled, exactly as
 * it already clears an automatic disable.
 */
export const setWorkflowTriggerEnabled = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.setTriggerEnabled,
  resolveContext: resolveTriggerTargetContext,
  async execute({ principal, input, context }): Promise<SetWorkflowTriggerEnabledResult> {
    // A legacy row id keeps the rows the editor shows; a block target sees only what runs.
    const liveness: TriggerLiveness = context.row ? 'editor' : 'running'
    const readLive = () => findLiveBlockTriggers({ ...context, liveness })
    const [, current] = await Promise.all([requireMutableWorkflow(context.workflowId), readLive()])
    if (current.length === 0) throw new OrchestrationError('not_found', context.notFoundMessage)
    const pending = current.filter((record) => !isInRequestedState(record, input.enabled))
    if (pending.length === 0) {
      return { trigger: toWorkflowTriggerHealth(current[0]), record: current[0], changes: [] }
    }

    const schedules: { id: string; nextRunAt: Date | null }[] = []
    const webhookIds: string[] = []
    for (const record of pending) {
      if (record.table === 'schedule') {
        schedules.push({
          id: record.row.id,
          nextRunAt: input.enabled ? nextScheduledRun(record.row) : null,
        })
      } else {
        webhookIds.push(record.row.id)
      }
    }
    if (input.enabled && webhookIds.length > 0) await assertWebhookEnableAllowed(principal, context)

    const updated = await setLiveTriggersEnabled({
      workflowId: context.workflowId,
      enabled: input.enabled,
      schedules,
      webhookIds,
      liveness,
      now: new Date(),
    })
    if (!updated) {
      // Nothing was written. Succeed only if a concurrent request already reached the requested state.
      const latest = await readLive()
      if (latest.length === 0) throw new OrchestrationError('not_found', context.notFoundMessage)
      if (latest.some((record) => !isInRequestedState(record, input.enabled))) {
        throw new OrchestrationError('conflict', 'Trigger changed during the update; retry')
      }
      return { trigger: toWorkflowTriggerHealth(latest[0]), record: latest[0], changes: [] }
    }

    const previousStatusById = new Map(
      pending.map((record) => [record.row.id, toWorkflowTriggerHealth(record).status])
    )
    const primary = updated.find((record) => record.row.id === current[0].row.id) ?? current[0]
    return {
      trigger: toWorkflowTriggerHealth(primary),
      record: primary,
      changes: updated.map((record) => ({
        record,
        previousStatus:
          previousStatusById.get(record.row.id) ?? toWorkflowTriggerHealth(record).status,
      })),
    }
  },
  projectAudit: ({ input, context, result }) =>
    result.changes.map(({ record, previousStatus }) => {
      const verb = input.enabled ? 'Enabled' : 'Disabled'
      const shared = {
        workflowId: context.workflowId,
        blockId: record.row.blockId,
        enabled: input.enabled,
        previousStatus,
      }
      if (record.table === 'schedule') {
        const { row } = record
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
      const provider = record.row.provider || 'generic'
      return {
        action: AuditAction.WEBHOOK_UPDATED,
        resourceType: AuditResourceType.WEBHOOK,
        resourceId: record.row.id,
        resourceName: provider,
        description: `${verb} ${provider} webhook`,
        metadata: { ...shared, provider },
      }
    }),
})
