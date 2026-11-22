/**
 * Workflows as workspace source: each `workflows/<key>/` folder is a workflow source directory,
 * planned and committed through the workflow source pipeline (`workflowSourceUpdate`,
 * `workflowSourceCreate`) and archived through `deleteWorkflow`, so compile, gates, locks, the per-workflow fingerprint
 * (409) and audit are exactly a single-workflow apply's. Folder placement is not managed.
 *
 * The kind's rule differs from the three-way rule the other kinds share, on purpose:
 * - An edited folder is checked against its own `.sim/base.json` (the single-workflow apply's
 *   409, re-checked under the workflow row lock), which keeps the folder appliable on its own with
 *   `sim workflows source apply`. The root base's fingerprint only guards a delete.
 * - A folder sent unchanged (only its base, `isUnchanged`) is a no-op with no drift check, so it
 *   never reports `W_SERVER_CHANGED`. The workflow's fingerprint hashes its canonicalized stored
 *   graph, so telling whether it drifted means reading and canonicalizing every declared workflow
 *   on every apply, the cost the unchanged folder exists to avoid; no cheaper stored token tracks
 *   it (the row's `updatedAt` also moves on a drag or a resize, which source never shows). The
 *   change is never lost: the next get prints it, and an edit of the folder is refused as stale.
 *   Folders sent whole that print exactly as their stored workflows are found by one batched read
 *   (`foldersAsStored`) and are no-ops the same way.
 * - New folders get their workflow ids at plan time, so folders that run each other resolve.
 */
import { createLogger } from '@sim/logger'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { getErrorMessage } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import {
  parseWorkflowLock,
  type SourceBase,
  stableStringify,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import {
  type BaseResource,
  fingerprintOf,
  isWorkspaceKind,
  type ResourceFingerprint,
  resourceAddress,
} from '@sim/workspace-code'
import { isResourceKeyed } from '@sim/workspace-code/kinds/registry'
import {
  type WorkflowDecl,
  workflowCodec,
  workflowFolder,
  workflowSourceBase,
} from '@sim/workspace-code/kinds/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  applyWorkflowSource,
  createWorkflowFromSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { requireMutableWorkflow } from '@/lib/workflows/application/mutability'
import {
  type ReadWorkflowSourceResult,
  readDraftFingerprint,
  readWorkflowSource,
  readWorkflowSources,
} from '@/lib/workflows/application/read-workflow-source'
import type { SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import {
  type PendingResource,
  type PlannedSource,
  type SourcePlanSummary,
  summarizePlan,
  workflowSourceCreate,
  workflowSourceUpdate,
} from '@/lib/workflows/application/source-pipeline'
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
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import { bindStored, claimKey, listUpTo } from '@/lib/workspace-source/application/keys'
import { liveTriggerCounts } from '@/lib/workspace-source/application/kinds/deployment/triggers'
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

const logger = createLogger('WorkspaceSourceWorkflows')

/** Workflows per page while listing a workspace's workflows. */
const LIST_PAGE = 200

/** Undeclared workflows a plan reads at once to fingerprint them for a delete. */
const FINGERPRINT_CONCURRENCY = 4

/** Edited workflow folders a plan evaluates at once. */
const PLAN_CONCURRENCY = 4

/**
 * Folders sent with their files below which a plan evaluates each one without first reading the
 * stored workflows to find those sent unchanged: one batched read costs about what evaluating a
 * folder does, so it pays only when many folders are sent whole (a directory without the CLI's
 * bookkeeping), not for the few a CLI apply sends because they were edited.
 */
const MIN_FOLDERS_TO_COMPARE = 4

/** Workflows a get reads together: one authorization and one graph load for each batch. */
const READ_BATCH = 50

/**
 * The root base's fingerprint of a workflow: its stored source fingerprint (`sf1:`), so a delete
 * can tell the workflow changed since the directory read it, as an edit's own `base` does.
 */
function workflowFingerprint(source: SourceBase): ResourceFingerprint {
  return fingerprintOf({ source: source.fingerprint })
}

/**
 * The fingerprint of workflow `workflowId` as it is stored now: the `sf1:` fingerprint a read
 * would report as `base.fingerprint`, computed without printing, so it writes nothing, records no
 * read and holds for a workflow grown past the print limits.
 */
async function readStoredFingerprint(
  ctx: SourceContext,
  workflowId: string
): Promise<ResourceFingerprint> {
  const fingerprint = await readDraftFingerprint.execute({
    principal: ctx.principal,
    input: { workflowId },
  })
  return fingerprintOf({ source: fingerprint })
}

/** Why `workflow` cannot be deleted for a lock (its own or its folder's), if so. */
async function lockOf(workflow: { id: string; name: string }): Promise<string | undefined> {
  try {
    await requireMutableWorkflow(workflow.id)
    return undefined
  } catch (error) {
    if (!(error instanceof OrchestrationError) || error.code !== 'locked') throw error
    return `"${workflow.name}" cannot be deleted: ${error.message.replace(/\.$/, '')}.`
  }
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

/**
 * A stored workflow carries its folder beside its id and name (two workflows of one folder cannot
 * share a name); the pipeline reads the rest.
 */
interface StoredWorkflowState {
  folderId: string | null
}

/** What a write applies, decided at plan time. */
export interface WorkflowPlan {
  /**
   * An update's validated lock and base, and the apply's `--allow-delete`, which also lets the
   * workflow's apply delete its blocks; a create has none.
   */
  update?: { lock: WorkflowLockV1; base: SourceBase; allowDelete: boolean }
  /**
   * A create's workflow id, minted at plan time so the other folders of the apply (a parent, or
   * a workflow that calls this one back) name it before it is written.
   */
  workflowId?: string
  /** The workflow's plan, which the write commits. */
  planned?: PlannedSource
}

type WorkflowChange = PlannedChange<'workflow'>

/**
 * The resources a compiled workflow names that a workspace directory declares: by the same key
 * for a kind whose source key is its resource key, once per member it names (an MCP server's
 * tools); by the id `planned` resolves for one keyed otherwise (a workspace file, whose source
 * key is its path), which the plan matches to that kind's change; and each secret it reads by name
 * (`env.NAME`).
 */
function sourceRefs(summary: SourcePlanSummary): NonNullable<WorkflowChange['refs']> {
  const refs = new Map<string, NonNullable<WorkflowChange['refs']>[number]>()
  for (const { kind, key, member, span } of summary.references) {
    if (!isWorkspaceKind(kind)) continue
    if (isResourceKeyed(kind)) {
      const id = JSON.stringify([kind, key, member ?? null])
      if (refs.has(id)) continue
      refs.set(id, {
        kind,
        key,
        ...(member !== undefined ? { member } : {}),
        ...(span !== undefined ? { span } : {}),
      })
      continue
    }
    const id = summary.resolveId(kind, key)
    if (id) refs.set(JSON.stringify([kind, key, null]), { kind, key, id })
  }
  for (const name of summary.envReferences) {
    refs.set(JSON.stringify(['secret', name, null]), { kind: 'secret', key: name })
  }
  return [...refs.values()]
}

/** The planned graph's blocks, id to normalized name, as a change's `blocks`. */
function blocksOf(summary: SourcePlanSummary): Pick<WorkflowChange, 'blocks'> {
  if (!summary.blocks) return {}
  const blocks = summary.blocks.map((block): [string, string] => [
    block.id,
    normalizeWorkflowBlockName(block.name),
  ])
  return { blocks: new Map(blocks) }
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
  const fields: string[] = [...(diff.meta ?? [])]
  if (blocks.added.length > 0) fields.push(`blocks +${blocks.added.length}`)
  if (blocks.removed.length > 0) fields.push(`blocks -${blocks.removed.length}`)
  if (blocks.renamed.length > 0) fields.push(`blocks renamed ${blocks.renamed.length}`)
  for (const block of blocks.modified) fields.push(`${block.key}: ${block.fields.join(', ')}`)
  if (edges.added + edges.removed > 0) fields.push(`connections +${edges.added} -${edges.removed}`)
  const changedVariables =
    variables.added.length +
    variables.removed.length +
    variables.renamed.length +
    variables.modified.length
  if (changedVariables > 0) fields.push(`variables ${changedVariables}`)
  return fields
}

/**
 * What an update deletes from the stored workflow: its removed blocks and variables, counted as a
 * table update counts its dropped columns, so the plan, its summary and a status's next step all
 * see a delete that needs `--allow-delete`. A removed block takes its stored identity with it
 * (run history keyed to it, a trigger's webhook URL), which applying an older copy does not bring
 * back.
 */
function deletedFrom(diff: SourceDiffSummary): Pick<WorkflowChange, 'destructive'> {
  const counts: Record<string, number> = {}
  if (diff.blocks.removed.length > 0) counts.blocks = diff.blocks.removed.length
  if (diff.variables.removed.length > 0) counts.variables = diff.variables.removed.length
  if (Object.keys(counts).length === 0) return {}
  return { destructive: { what: counts.blocks ? 'blocks' : 'variables', counts } }
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
 * Evaluates an edited folder of a stored workflow (plan only, no write). `pending` holds the
 * resources this apply creates or adopts first, which the evaluation resolves.
 */
async function planUpdate(
  change: WorkflowChange,
  update: { workflowId: string; base: SourceBase },
  ctx: PlanContext,
  pending: readonly PendingResource[],
  renamed: Map<string, string>
): Promise<WorkflowChange> {
  const { key, decl } = change
  if (!decl) return change
  const read = readLock(key, decl)
  if ('diagnostics' in read) {
    change.diagnostics.push(...read.diagnostics)
    return change
  }
  const outcome = await workflowSourceUpdate.plan.execute({
    principal: ctx.principal,
    input: {
      workflowId: update.workflowId,
      files: decl.files,
      lock: read.lock,
      base: update.base,
      allowDelete: ctx.allowDelete,
      pendingResources: pending,
      loads: ctx.loads,
    },
  })
  const result = summarizePlan(outcome)
  // The pipeline words a stale draft for a single-workflow directory; a workspace names the
  // folder and its own next step, as every other kind's stale finding does.
  change.diagnostics.push(
    ...inFolder(key, result.diagnostics).map((finding) =>
      finding.code === 'E_APPLY_STALE' ? staleFinding('workflow', key) : finding
    )
  )
  if (result.workflowName !== undefined && result.diff.meta?.includes('name')) {
    renamed.set(key, result.workflowName)
  }
  // A graph no-op that changes only idents, order or comments still writes its source meta.
  const metaOnly = result.diff.noop && result.sourceMetaChanged
  return {
    ...change,
    action: result.diff.noop && !metaOnly ? 'noop' : 'update',
    storedId: update.workflowId,
    fields: metaOnly ? ['names, order or comments'] : diffFields(result.diff),
    ...deletedFrom(result.diff),
    refs: sourceRefs(result),
    ...blocksOf(result),
    detail: {
      update: { lock: read.lock, base: update.base, allowDelete: ctx.allowDelete },
      ...(outcome.kind === 'planned' ? { planned: outcome } : {}),
    },
  }
}

/**
 * Evaluates a new folder (plan only, no write) as the workflow `created.id`, the id minted for
 * it. `pending` holds every workflow this apply creates beside the resources earlier kinds create
 * or adopt, so folders naming each other resolve whatever their order, a cycle included; `name`
 * is the workflow name it compiles to, when it compiled.
 */
async function planCreate(
  change: WorkflowChange,
  created: PendingResource,
  ctx: PlanContext,
  pending: readonly PendingResource[]
): Promise<{ change: WorkflowChange; name?: string }> {
  const { decl } = change
  if (!decl) return { change }
  const outcome = await workflowSourceCreate.plan.execute({
    principal: ctx.principal,
    input: {
      workspaceId: ctx.workspace.workspaceId,
      workflowId: created.id,
      files: decl.files,
      pendingResources: pending,
      loads: ctx.loads,
    },
  })
  const result = summarizePlan(outcome)
  change.diagnostics.push(...inFolder(change.key, result.diagnostics))
  return {
    change: {
      ...change,
      action: 'create',
      pending: created,
      fields: diffFields(result.diff),
      refs: sourceRefs(result),
      ...blocksOf(result),
      detail: {
        workflowId: created.id,
        ...(outcome.kind === 'planned' ? { planned: outcome } : {}),
      },
    },
    ...(result.workflowName !== undefined ? { name: result.workflowName } : {}),
  }
}

/**
 * `changes` with the workflows this apply creates ordered so each comes after the creates it
 * names, where they do not name each other in a cycle: written in that order, a failed write never
 * leaves a written workflow naming one that was never created. Other changes keep their place.
 */
function orderCreates(changes: WorkflowChange[]): WorkflowChange[] {
  const creates = new Map(
    changes.filter((change) => change.action === 'create').map((change) => [change.key, change])
  )
  const ordered: WorkflowChange[] = []
  const visited = new Set<string>()
  const visit = (change: WorkflowChange) => {
    if (visited.has(change.key)) return
    visited.add(change.key)
    for (const ref of change.refs ?? []) {
      const named = ref.kind === 'workflow' ? creates.get(ref.key) : undefined
      if (named) visit(named)
    }
    ordered.push(change)
  }
  for (const change of creates.values()) visit(change)
  let next = 0
  return changes.map((change) => (change.action === 'create' ? ordered[next++] : change))
}

/** A folder sent with its files whose base names a stored workflow, planned as an update. */
type UpdateStep = Extract<FolderStep, { update: unknown }>

/** Whether two folders' files are the same paths with the same text. */
function sameFiles(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
  const paths = Object.keys(a)
  return paths.length === Object.keys(b).length && paths.every((path) => b[path] === a[path])
}

/**
 * The keys of folders sent with their files that hold exactly what a read of their stored
 * workflow prints now (files and lock), read at the fingerprint the folder's base records: a
 * folder written by a get and sent whole. Applying one changes nothing, so the plan records it as
 * a no-op without evaluating it, as it does a folder sent as its base alone. The workflows are
 * read in batches through the read use case (one authorization, catalog gate and graph load per
 * batch); any other folder, or one whose batch cannot be read, is evaluated as usual.
 */
async function foldersAsStored(
  steps: readonly UpdateStep[],
  ctx: PlanContext
): Promise<Set<string>> {
  const matched = new Set<string>()
  if (steps.length < MIN_FOLDERS_TO_COMPARE) return matched
  for (const batch of chunkArray([...steps], READ_BATCH)) {
    let reads: Awaited<ReturnType<typeof readWorkflowSources.execute>>
    try {
      reads = await readWorkflowSources.execute({
        principal: ctx.principal,
        input: {
          workspaceId: ctx.workspace.workspaceId,
          workflowIds: batch.map((step) => step.update.workflowId),
          plan: true,
        },
      })
    } catch (error) {
      logger.warn('Could not read stored workflows to compare their folders', {
        error: getErrorMessage(error),
      })
      continue
    }
    for (const step of batch) {
      const read = reads.get(step.update.workflowId)
      const decl = step.change.decl
      if (!read || 'error' in read || !decl) continue
      const { source } = read
      if (
        source.base.fingerprint === step.update.base.fingerprint &&
        sameFiles(decl.files, source.files) &&
        decl.lock !== undefined &&
        stableStringify(decl.lock) === stableStringify(source.lock)
      ) {
        matched.add(step.change.key)
      }
    }
  }
  return matched
}

/** The key two workflows of one folder cannot share: the folder (`null` at the root) and the name. */
function folderName(folderId: string | null, name: string): string {
  return JSON.stringify([folderId, name])
}

/**
 * Refuses a rename onto a name another write of this apply gives a workflow of the same folder (a
 * create, which lands at the root, or another rename): each is checked only against the names
 * stored now, so both would plan and the second write would fail part-way. `names` holds the
 * creates' names by {@link folderName}.
 */
function refuseRenamesOntoOneName(
  updates: readonly UpdateStep[],
  renamed: ReadonlyMap<string, string>,
  planned: ReadonlyMap<string, WorkflowChange>,
  stored: StoredSet<StoredWorkflowState>,
  names: Map<string, string>
): void {
  const folders = new Map(
    [...stored.bound.values(), ...stored.unbound].map((workflow) => [
      workflow.id,
      workflow.state.folderId,
    ])
  )
  for (const step of updates) {
    const name = renamed.get(step.change.key)
    const change = planned.get(step.change.key)
    if (name === undefined || !change) continue
    const folderId = folders.get(step.update.workflowId) ?? null
    const file = `${workflowFolder(change.key)}/${SOURCE_ENTRY_FILE}`
    refuseDeclaredTwice(names, change, folderName(folderId, name), name, file)
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
 * Refuses every planned workflow delete when, with the workflows this apply creates, they would
 * leave the workspace no live workflow: the delete use case refuses its last workflow, so the plan
 * says so before anything is written. Creates are written before deletes, so a create counts, but
 * only one that will be written: the plan runs this after holding back changes, and a create held
 * or carrying an error writes nothing.
 */
export async function refuseDeletingEveryWorkflow(
  changes: readonly PlannedChange[],
  workspaceId: string
): Promise<void> {
  const workflows = changes.filter((change) => change.kind === 'workflow')
  const deletes = workflows.filter((change) => change.action === 'delete')
  if (deletes.length === 0) return
  const created = workflows.filter(
    (change) =>
      change.action === 'create' &&
      !change.held &&
      !change.diagnostics.some((finding) => finding.severity === 'error')
  ).length
  const live = await countLiveWorkflows(workspaceId)
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

export const workflowAdapter: KindAdapter<'workflow', StoredWorkflowState> = {
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
      state: { folderId: workflow.folderId ?? null },
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
    // Every create's id is minted first, so each folder resolves every workflow the apply creates.
    const creates = steps.flatMap((step) =>
      'create' in step
        ? [{ step, created: { kind: 'workflow' as const, key: step.change.key, id: generateId() } }]
        : []
    )
    const pending = [...ctx.pending, ...creates.map(({ created }) => created)]
    const names = new Map<string, string>()
    const evaluatedCreates = new Map<string, { change: WorkflowChange; name?: string }>()
    await mapWithConcurrency(creates, PLAN_CONCURRENCY, async ({ step, created }) => {
      try {
        evaluatedCreates.set(step.change.key, await planCreate(step.change, created, ctx, pending))
      } catch (error) {
        step.change.diagnostics.push(
          refusalDiagnostic(error, { kind: 'workflow', key: step.change.key })
        )
        evaluatedCreates.set(step.change.key, { change: step.change })
      }
    })
    // Every create lands in the workspace root, so two of one name cannot both be written.
    for (const { step } of creates) {
      const evaluated = evaluatedCreates.get(step.change.key)
      if (!evaluated) continue
      if (evaluated.name !== undefined) {
        const file = `${workflowFolder(evaluated.change.key)}/${SOURCE_ENTRY_FILE}`
        refuseDeclaredTwice(
          names,
          evaluated.change,
          folderName(null, evaluated.name),
          evaluated.name,
          file
        )
      }
      planned.set(step.change.key, evaluated.change)
    }
    const edited = steps.flatMap((step) => ('update' in step ? [step] : []))
    const asStored = await foldersAsStored(edited, ctx)
    const updates = edited.filter((step) => {
      if (!asStored.has(step.change.key)) return true
      planned.set(step.change.key, { ...step.change, storedId: step.update.workflowId })
      return false
    })
    const renamed = new Map<string, string>()
    await mapWithConcurrency(updates, PLAN_CONCURRENCY, async (step) => {
      const change = await refusing(step.change, () =>
        planUpdate(step.change, step.update, ctx, pending, renamed)
      )
      planned.set(change.key, change)
    })
    refuseRenamesOntoOneName(updates, renamed, planned, stored, names)
    const changes = orderCreates(steps.map((step) => planned.get(step.change.key) ?? step.change))
    // A delete is stale when the workflow changed on the server since the base recorded it; one
    // that cannot be read now never matches, so it is refused rather than deleted unseen. A locked
    // one (or one in a locked folder) is refused here, as the delete would refuse it mid-apply.
    const fingerprints = new Map<string, string>()
    const locks = new Map<string, string>()
    // A delete counts the live triggers its workflow serves: their webhook URLs and schedules go
    // with it, and a workflow created in its place gets new ones.
    const triggers = new Map<string, Record<string, number>>()
    if (ctx.allowDelete) {
      const claimed = new Set(changes.map((change) => change.storedId))
      const candidates = [...stored.bound].filter(
        ([key, workflow]) =>
          !desired.has(key) &&
          !claimed.has(workflow.id) &&
          ctx.base?.resources[resourceAddress('workflow', key)]?.id === workflow.id
      )
      await mapWithConcurrency(candidates, FINGERPRINT_CONCURRENCY, async ([, workflow]) => {
        const locked = await lockOf(workflow)
        if (locked) locks.set(workflow.id, locked)
        try {
          // Both or neither: a fingerprint without its trigger counts would plan a delete that
          // claims no live trigger is lost.
          const fingerprint = await readStoredFingerprint(ctx, workflow.id)
          const counts = await liveTriggerCounts(ctx, workflow.id)
          fingerprints.set(workflow.id, fingerprint)
          triggers.set(workflow.id, counts)
        } catch (error) {
          logger.warn('Could not read a workflow to fingerprint its delete', {
            workflowId: workflow.id,
            error: getErrorMessage(error),
          })
        }
      })
    }
    changes.push(
      ...planUndeclared('workflow', desired, stored, ctx, {
        declared: changes,
        fingerprint: (workflow) => fingerprints.get(workflow.id) ?? '',
        locked: (workflow) => locks.get(workflow.id),
        counts: (workflow) => triggers.get(workflow.id) ?? {},
      })
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
    if (change.decl && change.detail?.update) {
      await applyWorkflowSource.authorize({
        principal,
        input: { workflowId: change.storedId, ...change.detail.update, files: change.decl.files },
      })
    }
  },

  async storedFingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A workflow check needs the stored workflow id')
    return readStoredFingerprint(ctx, change.storedId)
  },

  async apply(change, ctx) {
    const { principal } = ctx
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('A workflow delete needs the stored workflow id')
      await deleteWorkflow.execute({ principal, input: { workflowId: change.storedId } })
      return { id: change.storedId, text: {} }
    }
    const update = change.detail?.update
    const planned = change.detail?.planned
    if (!planned || (change.action !== 'create' && !update)) {
      throw new Error('A workflow write needs its plan')
    }
    const provenance = ctx.provenance ? { provenance: ctx.provenance } : {}
    // A new folder has no base, so no later apply could adopt a workflow whose create committed
    // without its key: the create claims it in its own transaction, and a failed claim undoes it.
    const claimed: WorkspaceSourceDiagnostic[] = []
    const write = () =>
      update
        ? workflowSourceUpdate.commit.execute({ principal, input: { planned, ...provenance } })
        : workflowSourceCreate.commit.execute({
            principal,
            input: {
              planned,
              ...provenance,
              withinCreate: async (tx, workflowId) => {
                claimed.splice(0, claimed.length, ...(await claimKey(change, ctx, workflowId, tx)))
              },
            },
          })
    // The pipeline's own refusal is the apply's, with its findings pinned to the folder.
    const result = await write().catch((error: unknown) => {
      if (!(error instanceof WorkflowSourceRejectedError)) throw error
      throw new WorkspaceSourceRejectedError(inFolder(change.key, error.diagnostics))
    })
    ctx.writtenDrafts.set(result.workflowId, result.base.fingerprint)
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
      diagnostics: [...inFolder(change.key, result.diagnostics), ...claimed],
      ...(update ? {} : { keyClaimed: true as const }),
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
