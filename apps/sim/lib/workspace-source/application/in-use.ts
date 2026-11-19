/**
 * Stored workflows that still use a resource a plan deletes. The check reads the workflows as the
 * server stores them, by resource id, never the text the directory sent: a workflow folder sent
 * unchanged carries no files (its codec's `isUnchanged`), so its text names nothing.
 */
import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { WorkspaceKind } from '@sim/workspace-code'
import { sql } from 'drizzle-orm'
import {
  GET_HINT,
  kindFinding,
  refDeletedFinding,
  where,
} from '@/lib/workspace-source/application/findings'
import type {
  PlannedChange,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

const logger = createLogger('WorkspaceSourceInUse')

/** Workflows a warning names before it only counts the rest. */
const NAMED_WORKFLOWS = 5

interface UsingWorkflow {
  id: string
  name: string
}

/** How long the scan may run before a plan gives up on it and warns instead. */
const SCAN_TIMEOUT_MS = 5_000

/** The SQLSTATE of a statement cancelled by its `statement_timeout`. */
const QUERY_CANCELED = '57014'

/** A `LIKE` pattern matching text that contains `id` anywhere. */
function containing(id: string): string {
  return `%${id.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * The live workflows of the workspace whose blocks name any of `ids`, by resource id; `null` when
 * the scan did not finish within {@link SCAN_TIMEOUT_MS}, which every caller must treat as refusing
 * the delete. A block names a resource by its id as a
 * whole sub-block value, as an item of a list, or as one part of a comma-joined value, at any
 * depth (a tool's parameters included), the forms a workflow source read lifts to resource keys.
 * An id that only appears inside other text, such as a prompt that mentions it, names nothing.
 * The workspace's blocks are streamed through one text match against every id (each block's
 * sub-blocks cast to text once), so only the few that mention one are kept and walked value by
 * value; nothing is materialized for the rest.
 */
export async function workflowsUsing(
  workspaceId: string,
  ids: readonly string[]
): Promise<Map<string, UsingWorkflow[]> | null> {
  const using = new Map<string, UsingWorkflow[]>()
  if (ids.length === 0) return using
  const idList = sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )}]::text[]`
  const patterns = sql`ARRAY[${sql.join(
    ids.map((id) => sql`${containing(id)}`),
    sql`, `
  )}]::text[]`
  let rows: Array<{ resourceId: string; id: string; name: string }>
  try {
    rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${`${SCAN_TIMEOUT_MS}ms`}, true)`)
      return tx.execute<{ resourceId: string; id: string; name: string }>(sql`
        WITH candidates AS MATERIALIZED (
          SELECT ${workflow.id} AS id, ${workflow.name} AS name, ${workflowBlocks.subBlocks} AS doc,
            ${workflowBlocks.subBlocks}::text AS text
          FROM ${workflowBlocks}
          INNER JOIN ${workflow} ON ${workflow.id} = ${workflowBlocks.workflowId}
          WHERE ${workflow.workspaceId} = ${workspaceId} AND ${workflow.archivedAt} IS NULL
            AND ${workflowBlocks.subBlocks}::text LIKE ANY (${patterns})
        )
        SELECT DISTINCT referenced.id AS "resourceId", candidates.id, candidates.name
        FROM candidates
        INNER JOIN unnest(${idList}) AS referenced(id) ON strpos(candidates.text, referenced.id) > 0
        WHERE EXISTS (
          SELECT 1
          FROM jsonb_path_query(candidates.doc, 'strict $.**') AS leaf(value)
          WHERE jsonb_typeof(leaf.value) = 'string'
            AND referenced.id IN (
              SELECT btrim(part) FROM unnest(string_to_array(leaf.value #>> '{}', ',')) AS part
            )
        )
      `)
    })
  } catch (error) {
    if (getPostgresErrorCode(error) !== QUERY_CANCELED) throw error
    logger.warn('Workspace source in-use scan timed out', { workspaceId, ids: ids.length })
    return null
  }
  for (const row of rows) {
    const list = using.get(row.resourceId) ?? []
    list.push({ id: row.id, name: row.name })
    using.set(row.resourceId, list)
  }
  return using
}

/**
 * `E_APPLY_REFUSED` for a delete of `change`'s resource whose users the scan could not confirm in
 * time ({@link workflowsUsing} answered `null`): the delete is refused rather than made blind.
 */
export function inUseUncheckedFinding(change: Pick<PlannedChange, 'kind' | 'key'>) {
  return kindFinding(
    change.kind,
    change.key,
    'E_APPLY_REFUSED',
    `Could not confirm in time that no stored workflow uses ${where(change.kind, change.key)}, so it is not deleted.`,
    { hint: 'Apply again; if it keeps timing out, delete it from the workspace instead.' }
  )
}

/** What the in-use scan found for one delete. */
interface DeleteUsers {
  /** The declared workflow folders kept as stored that use the resource, with their keys. */
  declared: Array<UsingWorkflow & { key: string }>
  /** The stored workflows outside the directory that use it. */
  undeclared: UsingWorkflow[]
}

/**
 * The deletes the in-use check scans (a credential delete only unbinds its key and an undeploy
 * deletes no resource) and, for each, the stored workflows that still use the resource, or `null`
 * when the scan timed out. A workflow the directory declares unchanged (`unchanged` lists the keys
 * of each kind sent without files) keeps using it; one the apply deletes too is no user, and an
 * edited one is judged by the references its compiled source makes (the change's `refs`), unless
 * it is held back (`held`): its stored references stay.
 */
async function deleteUsers(
  changes: PlannedChange[],
  unchanged: ReadonlyMap<WorkspaceKind, ReadonlySet<string>>,
  workspaceId: string
): Promise<{ deleting: PlannedChange[]; users: Map<PlannedChange, DeleteUsers> | null }> {
  const deleting = changes.filter(
    (change) =>
      change.kind !== 'credential' &&
      change.kind !== 'deployment' &&
      change.storedId !== undefined &&
      change.action === 'delete'
  )
  if (deleting.length === 0) return { deleting, users: new Map() }
  const using = await workflowsUsing(
    workspaceId,
    deleting.flatMap((change) => change.storedId ?? [])
  )
  if (using === null) return { deleting, users: null }
  const deletedWorkflows = new Set<string>()
  // The workflows the directory declares, by stored id.
  const declared = new Map<string, { key: string; edited: boolean }>()
  for (const change of changes) {
    if (change.kind !== 'workflow' || change.storedId === undefined) continue
    if (change.action === 'delete') deletedWorkflows.add(change.storedId)
    else if (change.decl !== undefined) {
      // A folder whose source was evaluated and is written is judged by the references it
      // compiled to; one sent unchanged, found equal to its stored workflow without evaluating,
      // or held back (not written), by the stored one.
      const edited =
        !change.held && !unchanged.get('workflow')?.has(change.key) && change.refs !== undefined
      declared.set(change.storedId, { key: change.key, edited })
    }
  }
  const users = new Map<PlannedChange, DeleteUsers>()
  for (const change of deleting) {
    const found: DeleteUsers = { declared: [], undeclared: [] }
    for (const user of using.get(change.storedId ?? '') ?? []) {
      if (deletedWorkflows.has(user.id)) continue
      const folder = declared.get(user.id)
      if (folder?.edited) continue
      if (folder) found.declared.push({ ...user, key: folder.key })
      else found.undeclared.push(user)
    }
    users.set(change, found)
  }
  return { deleting, users }
}

/** The quoted names of `workflows`, up to {@link NAMED_WORKFLOWS}, then a count of the rest. */
function named(workflows: UsingWorkflow[]): string {
  const listed = workflows
    .slice(0, NAMED_WORKFLOWS)
    .map((user) => `"${user.name}"`)
    .join(', ')
  const more =
    workflows.length > NAMED_WORKFLOWS ? ` and ${workflows.length - NAMED_WORKFLOWS} more` : ''
  return `${listed}${more}`
}

/**
 * Checks every delete the plan makes against the stored workflows that use the resource (see
 * {@link deleteUsers}). A declared workflow kept as stored that uses it makes the delete
 * `E_PLAN_REF_DELETED`; one the directory does not declare is named in a warning, counted in the
 * delete's destructive line and recorded in its `inUseBy`, which the apply checks again under its
 * lease ({@link recheckDeletesInUse}).
 */
export async function checkDeletesInUse(
  changes: PlannedChange[],
  unchanged: ReadonlyMap<WorkspaceKind, ReadonlySet<string>>,
  workspaceId: string
): Promise<void> {
  // A delete refused for want of --allow-delete deletes nothing, so it is not scanned: the plan
  // that allows it (the CLI's dry run first) names the workflows. An update that would lose data
  // (a dropped column, a removed option) deletes nothing a workflow names.
  const { deleting, users } = await deleteUsers(changes, unchanged, workspaceId)
  // Fails closed: a delete whose users could not be checked is refused, never made blind.
  if (users === null) {
    for (const change of deleting) change.diagnostics.push(inUseUncheckedFinding(change))
    return
  }
  for (const [change, found] of users) {
    for (const { key } of found.declared) {
      change.diagnostics.push(refDeletedFinding({ kind: 'workflow', key }, change))
    }
    const { undeclared } = found
    if (undeclared.length === 0) continue
    change.inUseBy = undeclared.map((user) => user.id)
    if (change.destructive) change.destructive.counts.workflows = undeclared.length
    change.diagnostics.push(
      kindFinding(
        change.kind,
        change.key,
        'W_RESOURCE_IN_USE',
        `Deleting ${where(change.kind, change.key)} breaks ${undeclared.length} stored workflow(s) that use it: ${named(undeclared)}.`,
        { hint: 'Remove it from those workflows, or keep its declaration.' }
      )
    )
  }
}

/**
 * Scans the plan's deletes again once the apply holds the workspace's lease, before anything is
 * written: the plan scanned before the lease, so another apply could have saved a workflow that
 * uses a resource this one deletes in between. A delete that a workflow the plan did not find now
 * uses (`E_APPLY_STALE`), or whose users the scan could not confirm in time, is refused; the
 * findings it returns refuse the apply.
 */
export async function recheckDeletesInUse(
  changes: PlannedChange[],
  unchanged: ReadonlyMap<WorkspaceKind, ReadonlySet<string>>,
  workspaceId: string
): Promise<WorkspaceSourceDiagnostic[]> {
  const { deleting, users } = await deleteUsers(changes, unchanged, workspaceId)
  if (users === null) return deleting.map(inUseUncheckedFinding)
  const refused: WorkspaceSourceDiagnostic[] = []
  for (const [change, found] of users) {
    const known = new Set(change.inUseBy)
    const added = [...found.declared, ...found.undeclared].filter((user) => !known.has(user.id))
    if (added.length === 0) continue
    refused.push(
      kindFinding(
        change.kind,
        change.key,
        'E_APPLY_STALE',
        `${added.length} stored workflow(s) started using ${where(change.kind, change.key)} while this apply ran, so it is not deleted: ${named(added)}.`,
        { hint: GET_HINT }
      )
    )
  }
  return refused
}
