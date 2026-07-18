import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { buildBoundActionEntryFromDraft } from '@/lib/apps/bind-actions'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import type { ToolCallSummary } from '@/lib/copilot/request/types'
import { isRecordLike } from '@sim/utils/object'

export type BackendHandoffAction = {
  actionId: string
  workflowId: string
  workflowName: string
  description: string
  inputSchema: Record<string, unknown>
  outputAllowlist: AppActionManifestEntry['outputAllowlist']
  schemaHash: string
  action: AppActionManifestEntry
}

export type BackendHandoff = {
  actions: BackendHandoffAction[]
}

const WORKFLOW_MUTATION_TOOLS = new Set(['create_workflow', 'edit_workflow'])

function extractWorkflowIdFromResult(result: unknown): string | null {
  if (!isRecordLike(result)) return null
  if (typeof result.workflowId === 'string' && result.workflowId.length > 0) {
    return result.workflowId
  }
  return null
}

function isSuccessfulTerminalStatus(status: string): boolean {
  return status === 'success'
}

/**
 * Collect unique workflow IDs from successful create/edit tool calls, then
 * corroborate with chat resource upserts when provided.
 */
export function collectWorkflowIdsFromToolCalls(
  toolCalls: ToolCallSummary[],
  resourceWorkflowIds: string[] = []
): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()

  const push = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
  }

  for (const call of toolCalls) {
    if (!WORKFLOW_MUTATION_TOOLS.has(call.name)) continue
    if (!isSuccessfulTerminalStatus(String(call.status))) continue
    push(extractWorkflowIdFromResult(call.result))
    // edit_workflow also carries workflowId in params
    if (isRecordLike(call.params) && typeof call.params.workflowId === 'string') {
      push(call.params.workflowId)
    }
  }

  for (const id of resourceWorkflowIds) {
    push(id)
  }

  return ordered
}

export function slugifyActionId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
  if (!base) return 'action'
  if (/^[0-9]/.test(base)) return `action_${base}`
  return base
}

export function allocateActionIds(names: string[]): string[] {
  const used = new Map<string, number>()
  return names.map((name) => {
    const base = slugifyActionId(name)
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

/**
 * Load saved drafts for the collected workflow IDs and build typed App actions.
 */
export async function buildBackendHandoff(params: {
  workspaceId: string
  toolCalls: ToolCallSummary[]
  resourceWorkflowIds?: string[]
}): Promise<
  | { ok: true; handoff: BackendHandoff }
  | { ok: false; error: string; code: string }
> {
  const workflowIds = collectWorkflowIdsFromToolCalls(
    params.toolCalls,
    params.resourceWorkflowIds ?? []
  )

  if (workflowIds.length === 0) {
    return {
      ok: false,
      error:
        'Backend pass did not produce any saved workflows. Ask for API-compatible workflows with useful outputs, then retry.',
      code: 'NO_WORKFLOWS',
    }
  }

  const rows = await db
    .select({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      workspaceId: workflow.workspaceId,
      archivedAt: workflow.archivedAt,
    })
    .from(workflow)
    .where(and(inArray(workflow.id, workflowIds), isNull(workflow.archivedAt)))

  const byId = new Map(rows.map((row) => [row.id, row]))
  const validIds = workflowIds.filter((id) => {
    const row = byId.get(id)
    return Boolean(row && row.workspaceId === params.workspaceId && !row.archivedAt)
  })

  if (validIds.length === 0) {
    return {
      ok: false,
      error: 'Generated workflows were deleted, archived, or outside this workspace',
      code: 'NO_VALID_WORKFLOWS',
    }
  }

  const names = validIds.map((id) => byId.get(id)!.name)
  const actionIds = allocateActionIds(names)
  const actions: BackendHandoffAction[] = []

  for (let i = 0; i < validIds.length; i++) {
    const workflowId = validIds[i]!
    const row = byId.get(workflowId)!
    const bound = await buildBoundActionEntryFromDraft({
      workspaceId: params.workspaceId,
      actionId: actionIds[i]!,
      workflowId,
    })
    if (!bound.ok) {
      return {
        ok: false,
        error: `Workflow "${row.name}" is not App-ready: ${bound.error}`,
        code: bound.code || 'INVALID_WORKFLOW',
      }
    }

    actions.push({
      actionId: bound.action.actionId,
      workflowId,
      workflowName: row.name,
      description: row.description || `Run ${row.name}`,
      inputSchema: bound.action.inputSchema as Record<string, unknown>,
      outputAllowlist: bound.action.outputAllowlist,
      schemaHash: bound.action.schemaHash,
      action: bound.action,
    })
  }

  return { ok: true, handoff: { actions } }
}
