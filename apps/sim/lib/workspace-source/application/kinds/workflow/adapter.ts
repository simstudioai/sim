/**
 * Workflows as workspace source: each `workflows/<key>/` folder is a workflow source directory,
 * applied through the workflow source pipeline (`applyWorkflowSource`, `createWorkflowFromSource`)
 * and archived through `deleteWorkflow`, so compile, gates, locks, the per-workflow fingerprint
 * (409) and audit are exactly a single-workflow apply's. Folder placement is not managed.
 */
import { generateId } from '@sim/utils/id'
import { parseWorkflowLock, type SourceBase, type WorkflowLockV1 } from '@sim/workflow-code'
import type { BaseResource } from '@sim/workspace-code'
import {
  type WorkflowDecl,
  workflowCodec,
  workflowFolder,
  workflowSourceBase,
} from '@sim/workspace-code/kinds/workflow'
import { WORKFLOW_LOCK_FILE } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import {
  applyWorkflowSource,
  createWorkflowFromSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import type { SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import { refusalDiagnostic } from '@/lib/workspace-source/application/errors'
import {
  finding,
  noBaseFinding,
  planUndeclared,
  serverGoneFinding,
} from '@/lib/workspace-source/application/findings'
import { bindStored, claimKey } from '@/lib/workspace-source/application/keys'
import type {
  KindAdapter,
  PlanContext,
  PlannedChange,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/** Workflows per page while listing a workspace's workflows. */
const LIST_PAGE = 200

interface StoredWorkflowState {
  name: string
}

/** What an update applies, decided at plan time: the folder's validated lock and base. */
interface WorkflowPlan {
  workflowId: string
  lock: WorkflowLockV1
  base: SourceBase
}

type WorkflowChange = PlannedChange<WorkflowDecl, WorkflowPlan>

/** A workflow pipeline finding, pinned to its file in the workspace directory. */
function inFolder(
  key: string,
  diagnostics: ReadonlyArray<Omit<WorkspaceSourceDiagnostic, 'kind' | 'key'>>
): WorkspaceSourceDiagnostic[] {
  return diagnostics.map((finding) => ({
    ...finding,
    ...(finding.file !== undefined ? { file: `${workflowFolder(key)}/${finding.file}` } : {}),
    kind: 'workflow',
    key,
  }))
}

/** `blocks +2 -1 ~3, connections +1`: what a workflow apply changes, for the plan display. */
function diffFields(diff: SourceDiffSummary): string[] {
  const { blocks, edges, variables } = diff
  const fields: string[] = []
  if (blocks.added.length > 0) fields.push(`blocks +${blocks.added.length}`)
  if (blocks.removed.length > 0) fields.push(`blocks -${blocks.removed.length}`)
  if (blocks.renamed.length > 0) fields.push(`blocks renamed ${blocks.renamed.length}`)
  for (const block of blocks.modified) fields.push(`${block.key}: ${block.fields.join(', ')}`)
  if (edges.added + edges.removed > 0) fields.push(`connections +${edges.added} -${edges.removed}`)
  const changedVariables =
    variables.added.length + variables.removed.length + variables.modified.length
  if (changedVariables > 0) fields.push(`variables ${changedVariables}`)
  return fields
}

/** The folder's lock, or the findings that refuse it, pinned to `.sim/lock.json`. */
function readLock(
  key: string,
  decl: WorkflowDecl
): { lock: WorkflowLockV1 } | { diagnostics: WorkspaceSourceDiagnostic[] } {
  if (decl.lock === undefined) return { lock: { version: 1, blocks: {}, variables: {} } }
  const parsed = parseWorkflowLock(decl.lock)
  if (parsed.lock) return { lock: parsed.lock }
  return {
    diagnostics: parsed.diagnostics.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      file: `${workflowFolder(key)}/${WORKFLOW_LOCK_FILE}`,
      ...(finding.path !== undefined ? { path: finding.path } : {}),
      kind: 'workflow',
      key,
    })),
  }
}

async function planWorkflow(
  key: string,
  decl: WorkflowDecl,
  stored: StoredSet<StoredWorkflowState>,
  ctx: PlanContext
): Promise<WorkflowChange> {
  const change: WorkflowChange = { kind: 'workflow', key, action: 'noop', decl, diagnostics: [] }
  const { principal } = ctx
  const workspaceId = ctx.workspace.workspaceId
  const base = workflowSourceBase(decl)
  const existing =
    base && base.workspaceId === workspaceId
      ? [...stored.bound.values(), ...stored.unbound].find(
          (workflow) => workflow.id === base.workflowId
        )
      : undefined
  const holder = stored.bound.get(key)
  if (holder && holder.id !== existing?.id) {
    change.diagnostics.push(
      existing
        ? finding(
            'E_NAME_TAKEN',
            `The workflow key "${key}" belongs to "${holder.name}", not the workflow this folder was read from.`,
            { hint: 'Rename the folder back to the key it was read under.', kind: 'workflow', key }
          )
        : noBaseFinding('workflow', key)
    )
    return change
  }
  const unchanged = Object.keys(decl.files).length === 0
  if (unchanged && existing) return { ...change, storedId: existing.id }
  /** The folder's base names a workflow of this workspace the server no longer holds. */
  if (!existing && base?.workspaceId === workspaceId) {
    change.diagnostics.push(serverGoneFinding('workflow', key, !unchanged))
    return change
  }
  if (unchanged) {
    change.diagnostics.push(
      finding(
        'E_WORKFLOW_FILES_MISSING',
        `${workflowFolder(key)} was sent unchanged, but its base names no workflow of this workspace.`,
        {
          hint: 'Edit the folder so the apply sends its files and creates the workflow here.',
          kind: 'workflow',
          key,
        }
      )
    )
    return change
  }
  try {
    if (existing && base) {
      const read = readLock(key, decl)
      if ('diagnostics' in read) {
        change.diagnostics.push(...read.diagnostics)
        return change
      }
      const result = await applyWorkflowSource.execute({
        principal,
        input: {
          workflowId: existing.id,
          files: decl.files,
          lock: read.lock,
          base,
          dryRun: true,
          pendingResources: ctx.pending,
        },
      })
      change.diagnostics.push(...inFolder(key, result.diagnostics))
      return {
        ...change,
        action: result.diff.noop ? 'noop' : 'update',
        storedId: existing.id,
        fields: diffFields(result.diff),
        detail: { workflowId: existing.id, lock: read.lock, base },
      }
    }
    const result = await createWorkflowFromSource.execute({
      principal,
      input: { workspaceId, files: decl.files, dryRun: true, pendingResources: ctx.pending },
    })
    change.diagnostics.push(...inFolder(key, result.diagnostics))
    ctx.pending.push({ kind: 'workflow', key, id: generateId() })
    return { ...change, action: 'create', fields: diffFields(result.diff) }
  } catch (error) {
    change.diagnostics.push(refusalDiagnostic(error, { kind: 'workflow', key }))
    return change
  }
}

export const workflowAdapter: KindAdapter<WorkflowDecl, StoredWorkflowState, WorkflowPlan> = {
  codec: workflowCodec,

  async load(ctx, { allocate }) {
    const { workspaceId } = ctx.workspace
    const workflows: Array<{ id: string; name: string }> = []
    let cursorKeys: Awaited<ReturnType<typeof listWorkflows.execute>>['nextCursorKeys'] = null
    do {
      const page = await listWorkflows.execute({
        principal: ctx.principal,
        input: {
          workspaceId,
          scope: 'active',
          deployedOnly: false,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: LIST_PAGE,
          ...(cursorKeys ? { cursorKeys } : {}),
        },
      })
      workflows.push(...page.workflows)
      cursorKeys = page.nextCursorKeys
    } while (cursorKeys && workflows.length <= WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind)
    const records = workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      state: { name: workflow.name },
    }))
    return bindStored(ctx, 'workflow', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const changes: WorkflowChange[] = []
    for (const [key, decl] of desired) changes.push(await planWorkflow(key, decl, stored, ctx))
    changes.push(
      ...planUndeclared<StoredWorkflowState, WorkflowDecl, WorkflowPlan>(
        'workflow',
        desired,
        stored,
        ctx,
        () => ({ what: 'workflow', counts: { workflows: 1 } }),
        { declared: changes }
      )
    )
    return changes
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'create' && change.decl) {
      await createWorkflowFromSource.authorize({
        principal,
        input: { workspaceId, files: change.decl.files },
      })
      return
    }
    if (!change.storedId) return
    if (change.action === 'delete') {
      await deleteWorkflow.authorize({ principal, input: { workflowId: change.storedId } })
      return
    }
    if (change.decl && change.detail) {
      await applyWorkflowSource.authorize({
        principal,
        input: { ...change.detail, files: change.decl.files },
      })
    }
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('A workflow delete needs the stored workflow id')
      await deleteWorkflow.execute({ principal, input: { workflowId: change.storedId } })
      return { id: change.storedId, text: {} }
    }
    const decl = change.decl
    if (!decl) throw new Error('A workflow write needs its files')
    const provenance = ctx.provenance ? { provenance: ctx.provenance } : {}
    const plan = change.detail
    if (change.action !== 'create' && !plan) throw new Error('A workflow update needs its plan')
    const result = plan
      ? await applyWorkflowSource.execute({
          principal,
          input: { ...plan, files: decl.files, ...provenance },
        })
      : await createWorkflowFromSource.execute({
          principal,
          input: { workspaceId, files: decl.files, ...provenance },
        })
    const claimed = await claimKey(change, ctx, result.workflowId)
    const base: BaseResource = { id: result.workflowId }
    return {
      id: result.workflowId,
      base,
      text: workflowCodec.print(change.key, {
        files: result.files,
        lock: result.lock,
        base: result.base,
      }).text,
      diagnostics: [...inFolder(change.key, result.diagnostics), ...claimed],
    }
  },

  async read(stored, ctx) {
    const source = await readWorkflowSource.execute({
      principal: ctx.principal,
      input: { workflowId: stored.id },
    })
    const printed = workflowCodec.print(stored.key, {
      files: source.files,
      lock: source.lock,
      base: source.base,
    })
    return {
      text: printed.text,
      blobs: [],
      base: { id: stored.id },
      diagnostics: inFolder(stored.key, source.diagnostics),
    }
  },
}
