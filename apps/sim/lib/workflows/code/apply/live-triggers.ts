import { db } from '@sim/db'
import {
  chat,
  webhook,
  workflowDeploymentVersion,
  workflowMcpTool,
  workflowSchedule,
} from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import type { Diagnostic } from '@sim/workflow-code'
import type { BlockState } from '@sim/workflow-types/workflow'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'

type LiveEffect = 'webhook' | 'schedule' | 'chat output' | 'MCP tool'

type TriggerRemovedDiagnostic = Diagnostic<'W_APPLY_TRIGGER_REMOVED'>

function chatOutputBlockIds(outputConfigs: unknown): string[] {
  if (!Array.isArray(outputConfigs)) return []
  return outputConfigs.flatMap((config: unknown) =>
    isRecordLike(config) && typeof config.blockId === 'string' ? [config.blockId] : []
  )
}

/**
 * One warning per stored block the apply deletes or retypes while the live deployment still
 * serves something from it: a webhook or schedule registered for the block, a deployed chat that
 * streams its output, or the workflow's MCP tool when the block is the start trigger that defines
 * the tool's inputs. Source apply writes only the draft, so nothing stops yet: the deployment keeps
 * serving them until the next deploy, which removes them. A workflow with no active deployment
 * serves nothing and gets no warning. `keyOf` names a block's source key by id.
 */
export async function findLiveTriggerRemovals(
  workflowId: string,
  dropped: BlockState[],
  keyOf: (id: string) => string | undefined
): Promise<TriggerRemovedDiagnostic[]> {
  if (dropped.length === 0) return []
  const [active] = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  if (!active) return []

  const ids = dropped.map((block) => block.id)
  const [webhooks, schedules, chats, mcpTools] = await Promise.all([
    db
      .select({ blockId: webhook.blockId })
      .from(webhook)
      .where(
        and(
          eq(webhook.workflowId, workflowId),
          eq(webhook.deploymentVersionId, active.id),
          inArray(webhook.blockId, ids),
          eq(webhook.isActive, true),
          isNull(webhook.archivedAt)
        )
      ),
    db
      .select({ blockId: workflowSchedule.blockId })
      .from(workflowSchedule)
      .where(
        and(
          eq(workflowSchedule.workflowId, workflowId),
          eq(workflowSchedule.deploymentVersionId, active.id),
          inArray(workflowSchedule.blockId, ids),
          eq(workflowSchedule.status, 'active'),
          isNull(workflowSchedule.archivedAt)
        )
      ),
    db
      .select({ outputConfigs: chat.outputConfigs })
      .from(chat)
      .where(
        and(eq(chat.workflowId, workflowId), eq(chat.isActive, true), isNull(chat.archivedAt))
      ),
    db
      .select({ id: workflowMcpTool.id })
      .from(workflowMcpTool)
      .where(and(eq(workflowMcpTool.workflowId, workflowId), isNull(workflowMcpTool.archivedAt)))
      .limit(1),
  ])

  const effects = new Map<string, Set<LiveEffect>>()
  const note = (blockId: string | null, effect: LiveEffect) => {
    if (!blockId) return
    const set = effects.get(blockId) ?? new Set<LiveEffect>()
    set.add(effect)
    effects.set(blockId, set)
  }
  for (const row of webhooks) note(row.blockId, 'webhook')
  for (const row of schedules) note(row.blockId, 'schedule')
  for (const row of chats) {
    for (const blockId of chatOutputBlockIds(row.outputConfigs)) note(blockId, 'chat output')
  }
  if (mcpTools.length > 0) {
    for (const block of dropped)
      if (isInputDefinitionTrigger(block.type)) note(block.id, 'MCP tool')
  }

  return dropped.flatMap((block): TriggerRemovedDiagnostic[] => {
    const found = effects.get(block.id)
    if (!found) return []
    const list = [...found].join(', ')
    const blockKey = keyOf(block.id)
    return [
      {
        code: 'W_APPLY_TRIGGER_REMOVED',
        severity: 'warning',
        message: `Block "${block.name}" is removed or retyped in the draft, but the live deployment still serves its ${list}. This apply changes only the draft: they keep running until the next deploy, which removes them.`,
        hint: 'Keep the block, or deploy when you are ready for them to stop.',
        blockId: block.id,
        ...(blockKey !== undefined ? { blockKey } : {}),
      },
    ]
  })
}
