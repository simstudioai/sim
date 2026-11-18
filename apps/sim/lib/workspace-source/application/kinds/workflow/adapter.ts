/**
 * Workflows as workspace source: each `workflows/<key>/` folder is a workflow source directory,
 * applied through the workflow source pipeline (`applyWorkflowSource`, `createWorkflowFromSource`)
 * and archived through `deleteWorkflow`, so compile, gates, locks, the per-workflow fingerprint
 * (409) and audit are exactly a single-workflow apply's. Folder placement is not managed.
 *
 * The kind's rule differs from the three-way rule the other kinds share, on purpose:
 * - An edited folder is checked against its own `.sim/base.json` (the single-workflow apply's
 *   409, re-checked under the workflow row lock), which keeps the folder appliable on its own with
 *   `sim workflows source apply`. The root base's fingerprint only guards a delete.
 * - A folder sent unchanged (only its base, `isUnchanged`) is a no-op with no drift check, so it
 *   never reports `I_SERVER_CHANGED`. The workflow's fingerprint hashes its canonicalized stored
 *   graph, so telling whether it drifted means reading and canonicalizing every declared workflow
 *   on every apply, the cost the unchanged folder exists to avoid; no cheaper stored token tracks
 *   it (the row's `updatedAt` also moves on a drag or a resize, which source never shows). The
 *   change is never lost: the next get prints it, and an edit of the folder is refused as stale.
 */
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { parseWorkflowLock, type SourceBase, type WorkflowLockV1 } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import {
  type BaseResource,
  fingerprintOf,
  isWorkspaceKind,
  type ResourceFingerprint,
  resourceAddress,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isResourceKeyed } from '@sim/workspace-code/kinds/registry'
import {
  type WorkflowDecl,
  workflowCodec,
  workflowFolder,
  workflowSourceBase,
} from '@sim/workspace-code/kinds/workflow'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  applyWorkflowSource,
  createWorkflowFromSource,
  type EvaluatedSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import {
  type ReadWorkflowSourceResult,
  readWorkflowSource,
  readWorkflowSources,
} from '@/lib/workflows/application/read-workflow-source'
import type { SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import type { PendingResource } from '@/lib/workflows/application/source-evaluate'
import {
  countLiveWorkflows,
  LAST_WORKFLOW_MESSAGE,
} from '@/lib/workflows/orchestration/workflow-lifecycle'
import {
  refusalDiagnostic,
  WorkspaceSourceRejectedError,
} from '@/lib/workspace-source/application/errors'
import {
  kindFinding,
  noBaseFinding,
  planUndeclared,
  refuseDeclaredTwice,
  serverGoneFinding,
} from '@/lib/workspace-source/application/findings'
import { bindStored, listUpTo, pendingOf } from '@/lib/workspace-source/application/keys'
import type {
  KindAdapter,
  PlanContext,
  PlannedChange,
  ReadOutcome,
  ReadResource,
  SourceContext,
  StoredResource,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import type { ResourceKeyRef } from '@/lib/workspaces/resource-keys'

const logger = createLogger('WorkspaceSourceWorkflows')

/** Workflows per page while listing a workspace's workflows. */
const LIST_PAGE = 200

/** Undeclared workflows a plan reads at once to fingerprint them for a delete. */
const FINGERPRINT_CONCURRENCY = 4

/** Edited workflow folders a plan evaluates at once. */
const PLAN_CONCURRENCY = 4

/** Workflows a get reads together: one authorization and one graph load for each batch. */
const READ_BATCH = 50

/**
 * The root base's fingerprint of a workflow: its stored source fingerprint (`sf1:`), so a delete
 * can tell the workflow changed since the directory read it, as an edit's own `base` does.
 */
function workflowFingerprint(source: SourceBase): ResourceFingerprint {
  return fingerprintOf({ source: source.fingerprint })
}

/** The fingerprint of workflow `workflowId` as it is stored now. */
async function currentFingerprint(
  ctx: SourceContext,
  workflowId: string
): Promise<ResourceFingerprint> {
  const source = await readWorkflowSource.execute({
    principal: ctx.principal,
    input: { workflowId },
  })
  return workflowFingerprint(source.base)
}

/** A workflow's source as its folder prints it, with its base entry. */
function readOf(
  stored: StoredResource<StoredWorkflowState>,
  source: Pick<ReadWorkflowSourceResult, 'files' | 'lock' | 'base' | 'diagnostics'>
): ReadResource {
  const printed = workflowCodec.print(stored.key, {
    files: source.files,
    lock: source.lock,
    base: source.base,
  })
  return {
    text: printed.text,
    blobs: [],
    base: { id: stored.id, fingerprint: workflowFingerprint(source.base) },
    diagnostics: inFolder(stored.key, source.diagnostics),
  }
}

/** A stored workflow carries nothing beyond its id and name: the pipeline reads the rest. */
type StoredWorkflowState = null

/** What a write applies, decided at plan time. */
interface WorkflowPlan {
  /** An update's validated lock and base; a create has none. */
  update?: { lock: WorkflowLockV1; base: SourceBase }
  /**
   * The plan's evaluation, which the write commits without evaluating again; absent when it
   * resolved a resource this apply creates first, whose stand-in id the write must replace.
   */
  evaluated?: EvaluatedSource
}

type WorkflowChange = PlannedChange<WorkflowDecl, WorkflowPlan>

/**
 * The resources a compiled workflow names that a workspace directory declares by the same key: a
 * kind whose source key is its resource key (a workspace file's source key is its path).
 */
function sourceRefs(references: readonly ResourceKeyRef[]): NonNullable<WorkflowChange['refs']> {
  const refs = new Map<string, { kind: WorkspaceKind; key: string }>()
  for (const { kind, key } of references) {
    if (isWorkspaceKind(kind) && isResourceKeyed(kind)) refs.set(`${kind}:${key}`, { kind, key })
  }
  return [...refs.values()]
}

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
      file: `${workflowFolder(key)}/${SOURCE_LOCK_FILE}`,
      ...(finding.path !== undefined ? { path: finding.path } : {}),
      kind: 'workflow',
      key,
    })),
  }
}

/**
 * Declared folders sent with their files whose base names the same workflow as another declared
 * folder's, other than the folder bound to that workflow: copies (`cp -r`), each mapped to the
 * folder it was copied from. Writing one would overwrite that workflow and take its key, so the
 * plan refuses it. A folder sent as its base alone writes nothing, so it is never refused.
 */
function copiedFolders(
  desired: ReadonlyMap<string, WorkflowDecl>,
  stored: StoredSet<StoredWorkflowState>,
  workspaceId: string
): Map<string, string> {
  const keysByWorkflow = new Map<string, string[]>()
  for (const [key, decl] of desired) {
    const base = workflowSourceBase(decl)
    if (base?.workspaceId !== workspaceId) continue
    keysByWorkflow.set(base.workflowId, [...(keysByWorkflow.get(base.workflowId) ?? []), key])
  }
  const copies = new Map<string, string>()
  for (const [workflowId, keys] of keysByWorkflow) {
    if (keys.length < 2) continue
    const bound = keys.find((key) => stored.bound.get(key)?.id === workflowId)
    for (const key of keys) {
      if (key === bound || Object.keys(desired.get(key)?.files ?? {}).length === 0) continue
      copies.set(key, bound ?? keys.find((other) => other !== key) ?? key)
    }
  }
  return copies
}

/** `E_WORKFLOW_FOLDER_COPIED`: folder `key` holds the base of folder `original`. */
function copiedFinding(key: string, original: string): WorkspaceSourceDiagnostic {
  return kindFinding(
    'workflow',
    key,
    'E_WORKFLOW_FOLDER_COPIED',
    `${workflowFolder(key)} holds the ${SOURCE_BASE_FILE} of ${workflowFolder(original)}, so applying it would overwrite that workflow.`,
    {
      hint: `To create ${workflowFolder(key)} as a new workflow, delete its .sim/ folder; to keep one workflow, delete one of the two folders.`,
      file: `${workflowFolder(key)}/${SOURCE_BASE_FILE}`,
    }
  )
}

/**
 * What planning a folder takes: a decided change (a no-op, or a refusal), an update of a stored
 * workflow to evaluate, or a create to evaluate.
 */
type FolderStep =
  | { change: WorkflowChange }
  | { change: WorkflowChange; update: { workflowId: string; base: SourceBase } }
  | { change: WorkflowChange; create: true }

/** Decides what planning folder `key` takes, without evaluating it. */
function classifyFolder(
  key: string,
  decl: WorkflowDecl,
  stored: StoredSet<StoredWorkflowState>,
  workspaceId: string,
  copiedFrom: string | undefined
): FolderStep {
  const change: WorkflowChange = { kind: 'workflow', key, action: 'noop', decl, diagnostics: [] }
  const base = workflowSourceBase(decl)
  const existing =
    base && base.workspaceId === workspaceId
      ? [...stored.bound.values(), ...stored.unbound].find(
          (workflow) => workflow.id === base.workflowId
        )
      : undefined
  if (copiedFrom !== undefined) {
    change.diagnostics.push(copiedFinding(key, copiedFrom))
    // It still targets the workflow, so the plan never reads that workflow as undeclared.
    return { change: { ...change, ...(existing ? { storedId: existing.id } : {}) } }
  }
  const holder = stored.bound.get(key)
  if (holder && holder.id !== existing?.id) {
    change.diagnostics.push(
      existing
        ? kindFinding(
            'workflow',
            key,
            'E_NAME_TAKEN',
            `The workflow key "${key}" belongs to "${holder.name}", not the workflow this folder was read from.`,
            { hint: 'Rename the folder back to the key it was read under.' }
          )
        : noBaseFinding('workflow', key)
    )
    return { change }
  }
  const unchanged = Object.keys(decl.files).length === 0
  if (unchanged && existing) return { change: { ...change, storedId: existing.id } }
  // The folder's base names a workflow of this workspace the server no longer holds.
  if (!existing && base?.workspaceId === workspaceId) {
    change.diagnostics.push(serverGoneFinding('workflow', key, !unchanged))
    return { change }
  }
  if (unchanged) {
    change.diagnostics.push(
      kindFinding(
        'workflow',
        key,
        'E_WORKFLOW_FILES_MISSING',
        `${workflowFolder(key)} was sent unchanged, but its base names no workflow of this workspace.`,
        { hint: 'Edit the folder so the apply sends its files and creates the workflow here.' }
      )
    )
    return { change }
  }
  if (existing && base) return { change, update: { workflowId: existing.id, base } }
  return { change, create: true }
}

/**
 * Whether a plan's evaluation still holds at write time: it resolved no stand-in id of a resource
 * this apply creates first (those get their real ids only once written).
 */
function commitsAsPlanned(
  references: readonly ResourceKeyRef[],
  pending: readonly PendingResource[]
): boolean {
  return !references.some((ref) =>
    pending.some((entry) => entry.placeholder && entry.kind === ref.kind && entry.key === ref.key)
  )
}

/**
 * Evaluates an edited folder of a stored workflow (plan only, no write). `pending` holds the
 * resources this apply creates or adopts first, which the evaluation resolves.
 */
async function planUpdate(
  change: WorkflowChange,
  update: { workflowId: string; base: SourceBase },
  ctx: PlanContext,
  pending: readonly PendingResource[]
): Promise<WorkflowChange> {
  const { key, decl } = change
  if (!decl) return change
  const read = readLock(key, decl)
  if ('diagnostics' in read) {
    change.diagnostics.push(...read.diagnostics)
    return change
  }
  const result = await applyWorkflowSource.execute({
    principal: ctx.principal,
    input: {
      workflowId: update.workflowId,
      files: decl.files,
      lock: read.lock,
      base: update.base,
      planOnly: true,
      pendingResources: pending,
      shared: ctx.shared,
    },
  })
  change.diagnostics.push(...inFolder(key, result.diagnostics))
  // A graph no-op that changes only idents, order or comments still writes its source meta.
  const metaOnly = result.diff.noop && result.sourceMetaChanged
  const evaluated =
    result.evaluated && commitsAsPlanned(result.references, pending) ? result.evaluated : undefined
  return {
    ...change,
    action: result.diff.noop && !metaOnly ? 'noop' : 'update',
    storedId: update.workflowId,
    fields: metaOnly ? ['names, order or comments'] : diffFields(result.diff),
    refs: sourceRefs(result.references),
    detail: { update: { lock: read.lock, base: update.base }, ...(evaluated ? { evaluated } : {}) },
  }
}

/**
 * Evaluates a new folder (plan only, no write). A create carries its own pending entry, so a
 * later folder naming it resolves; `name` is the workflow name it compiles to, when it compiled.
 */
async function planCreate(
  change: WorkflowChange,
  ctx: PlanContext,
  pending: readonly PendingResource[]
): Promise<{ change: WorkflowChange; name?: string }> {
  const { decl } = change
  if (!decl) return { change }
  const result = await createWorkflowFromSource.execute({
    principal: ctx.principal,
    input: {
      workspaceId: ctx.workspace.workspaceId,
      files: decl.files,
      planOnly: true,
      pendingResources: pending,
      shared: ctx.shared,
    },
  })
  change.diagnostics.push(...inFolder(change.key, result.diagnostics))
  const evaluated =
    result.evaluated && commitsAsPlanned(result.references, pending) ? result.evaluated : undefined
  return {
    change: {
      ...change,
      action: 'create',
      pending: pendingOf({ ...change, action: 'create' }),
      fields: diffFields(result.diff),
      refs: sourceRefs(result.references),
      ...(evaluated ? { detail: { evaluated } } : {}),
    },
    ...(result.evaluated ? { name: result.workflowName } : {}),
  }
}

/** Runs one folder's evaluation, turning its refusal into the folder's finding. */
async function refusing(
  change: WorkflowChange,
  evaluate: () => Promise<WorkflowChange>
): Promise<WorkflowChange> {
  try {
    return await evaluate()
  } catch (error) {
    change.diagnostics.push(refusalDiagnostic(error, { kind: 'workflow', key: change.key }))
    return change
  }
}

/**
 * Refuses every planned delete when, with the workflows this apply creates, they would leave the
 * workspace no live workflow: the delete use case refuses its last workflow, so the plan says so
 * before anything is written. Creates are written before deletes, so a create counts.
 */
async function refuseDeletingEveryWorkflow(
  changes: WorkflowChange[],
  ctx: PlanContext
): Promise<void> {
  const deletes = changes.filter((change) => change.action === 'delete')
  if (deletes.length === 0) return
  const created = changes.filter((change) => change.action === 'create').length
  const live = await countLiveWorkflows(ctx.workspace.workspaceId)
  if (live + created - deletes.length >= 1) return
  for (const change of deletes) {
    change.action = 'noop'
    change.diagnostics.push(
      kindFinding('workflow', change.key, 'E_APPLY_REFUSED', LAST_WORKFLOW_MESSAGE, {
        hint: 'Keep one workflow declared, or add another before deleting this one.',
      })
    )
  }
}

export const workflowAdapter: KindAdapter<WorkflowDecl, StoredWorkflowState, WorkflowPlan> = {
  codec: workflowCodec,
  keys: 'every-write',

  async load(ctx, { allocate }) {
    const { workspaceId } = ctx.workspace
    type CursorKeys = Awaited<ReturnType<typeof listWorkflows.execute>>['nextCursorKeys']
    const workflows = await listUpTo(async (cursorKeys: CursorKeys | undefined) => {
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
      return { items: page.workflows, next: page.nextCursorKeys }
    })
    const records = workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      state: null,
    }))
    return bindStored(ctx, 'workflow', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const { workspaceId } = ctx.workspace
    const copies = copiedFolders(desired, stored, workspaceId)
    const steps = [...desired].map(([key, decl]) =>
      classifyFolder(key, decl, stored, workspaceId, copies.get(key))
    )
    const planned = new Map<string, WorkflowChange>()
    // Creates first, in order: each resolves the creates before it, as the writes will run.
    const pending = [...ctx.pending]
    const names = new Map<string, string>()
    for (const step of steps) {
      if (!('create' in step)) continue
      const change = await refusing(step.change, async () => {
        const created = await planCreate(step.change, ctx, pending)
        if (created.change.pending) pending.push(created.change.pending)
        // Every create lands in the workspace root, so two of one name cannot both be written.
        if (created.name !== undefined) {
          const file = `${workflowFolder(created.change.key)}/${SOURCE_ENTRY_FILE}`
          refuseDeclaredTwice(names, created.change, created.name, created.name, file)
        }
        return created.change
      })
      planned.set(change.key, change)
    }
    // Updates depend on nothing but the creates, so they evaluate together.
    const updates = steps.flatMap((step) => ('update' in step ? [step] : []))
    await mapWithConcurrency(updates, PLAN_CONCURRENCY, async (step) => {
      const change = await refusing(step.change, () =>
        planUpdate(step.change, step.update, ctx, pending)
      )
      planned.set(change.key, change)
    })
    const changes = steps.map((step) => planned.get(step.change.key) ?? step.change)
    // A delete is stale when the workflow changed on the server since the base recorded it; one
    // that cannot be read now never matches, so it is refused rather than deleted unseen.
    const fingerprints = new Map<string, string>()
    if (ctx.allowDelete) {
      const claimed = new Set(changes.map((change) => change.storedId))
      const candidates = [...stored.bound].filter(
        ([key, workflow]) =>
          !desired.has(key) &&
          !claimed.has(workflow.id) &&
          ctx.base?.resources[resourceAddress('workflow', key)]?.id === workflow.id
      )
      await mapWithConcurrency(candidates, FINGERPRINT_CONCURRENCY, async ([, workflow]) => {
        try {
          fingerprints.set(workflow.id, await currentFingerprint(ctx, workflow.id))
        } catch (error) {
          logger.warn('Could not read a workflow to fingerprint its delete', {
            workflowId: workflow.id,
            error: getErrorMessage(error),
          })
        }
      })
    }
    changes.push(
      ...planUndeclared<StoredWorkflowState, WorkflowDecl, WorkflowPlan>(
        'workflow',
        desired,
        stored,
        ctx,
        {
          declared: changes,
          fingerprint: (workflow) => fingerprints.get(workflow.id) ?? '',
        }
      )
    )
    await refuseDeletingEveryWorkflow(changes, ctx)
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
    if (change.decl && change.detail?.update) {
      await applyWorkflowSource.authorize({
        principal,
        input: { workflowId: change.storedId, ...change.detail.update, files: change.decl.files },
      })
    }
  },

  async fingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A workflow check needs the stored workflow id')
    return currentFingerprint(ctx, change.storedId)
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
    const update = change.detail?.update
    if (change.action !== 'create' && (!update || !change.storedId)) {
      throw new Error('A workflow update needs its plan')
    }
    const submission = {
      files: decl.files,
      shared: ctx.shared,
      ...(ctx.provenance ? { provenance: ctx.provenance } : {}),
      ...(change.detail?.evaluated ? { evaluated: change.detail.evaluated } : {}),
    }
    const write = () =>
      update && change.storedId
        ? applyWorkflowSource.execute({
            principal,
            input: { workflowId: change.storedId, ...update, ...submission },
          })
        : createWorkflowFromSource.execute({ principal, input: { workspaceId, ...submission } })
    // The pipeline's own refusal is the apply's, with its findings pinned to the folder.
    const result = await write().catch((error: unknown) => {
      if (!(error instanceof WorkflowSourceRejectedError)) throw error
      throw new WorkspaceSourceRejectedError(inFolder(change.key, error.diagnostics))
    })
    const base: BaseResource = {
      id: result.workflowId,
      fingerprint: workflowFingerprint(result.base),
    }
    return {
      id: result.workflowId,
      base,
      text: workflowCodec.print(change.key, {
        files: result.files,
        lock: result.lock,
        base: result.base,
      }).text,
      diagnostics: inFolder(change.key, result.diagnostics),
    }
  },

  async read(stored, ctx) {
    const source = await readWorkflowSource.execute({
      principal: ctx.principal,
      input: { workflowId: stored.id },
    })
    return readOf(stored, source)
  },

  async readMany(stored, ctx) {
    const outcomes = new Map<string, ReadOutcome>()
    for (const batch of chunkArray(stored, READ_BATCH)) {
      const reads = await readWorkflowSources.execute({
        principal: ctx.principal,
        input: {
          workspaceId: ctx.workspace.workspaceId,
          workflowIds: batch.map((workflow) => workflow.id),
        },
      })
      for (const workflow of batch) {
        const read = reads.get(workflow.id)
        if (!read) continue
        outcomes.set(
          workflow.key,
          'error' in read ? { error: read.error } : { read: readOf(workflow, read.source) }
        )
      }
    }
    return outcomes
  },
}
