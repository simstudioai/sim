/**
 * Stored workflows that still use a resource a plan deletes. The check reads the workflows as the
 * server stores them, by resource id, never the text the directory sent: a workflow folder sent
 * unchanged carries no files (its codec's `isUnchanged`), so its text names nothing. A deployed
 * workflow's live version runs apart from its draft, so the check reads it too.
 */
import { db } from '@sim/db'
import { workflow, workflowBlocks, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { WorkspaceKind } from '@sim/workspace-code'
import { sql } from 'drizzle-orm'
import { kindFinding, refDeletedFinding, where } from '@/lib/workspace-source/application/findings'
import type { PlannedChange } from '@/lib/workspace-source/application/types'

const logger = createLogger('WorkspaceSourceInUse')

/** Workflows a warning names before it only counts the rest. */
const NAMED_WORKFLOWS = 5

interface UsingWorkflow {
  id: string
  name: string
  /** The workflow's draft uses the resource. */
  draft: boolean
  /** The live version of the workflow's deployment uses the resource. */
  live: boolean
}

/** One row of the scan: a workflow using one of the scanned resources. */
type ScanRow = { resourceId: string; id: string; name: string; draft: boolean; live: boolean }

/** How long the scan may run before a plan gives up on it and warns instead. */
const SCAN_TIMEOUT_MS = 5_000

/** The SQLSTATE of a statement cancelled by its `statement_timeout`. */
const QUERY_CANCELED = '57014'

/** A `LIKE` pattern matching text that contains `id` anywhere. */
function containing(id: string): string {
  return `%${id.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * The live workflows of the workspace whose blocks name any of `ids`, by resource id, in their
 * draft or in the live version of their deployment (`draft`, `live`);
 * `null` when the scan did not finish within {@link SCAN_TIMEOUT_MS}, which every caller must
 * treat as refusing the delete. A block names a resource by its id as a whole sub-block value, as
 * an item of a list, or as one part of a comma-joined value, at any depth (a tool's parameters
 * included), the forms a workflow source read lifts to resource keys. An id that only appears
 * inside other text, such as a prompt that mentions it, names nothing. The workspace's blocks and
 * live versions are streamed through one text match against every id (each cast to text once), so
 * only the few that mention one are kept and walked value by value; nothing is materialized for
 * the rest.
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
  let rows: ScanRow[]
  try {
    rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${`${SCAN_TIMEOUT_MS}ms`}, true)`)
      return tx.execute<ScanRow>(sql`
        WITH candidates AS MATERIALIZED (
          SELECT ${workflow.id} AS id, ${workflow.name} AS name, ${workflowBlocks.subBlocks} AS doc,
            ${workflowBlocks.subBlocks}::text AS text, false AS live
          FROM ${workflowBlocks}
          INNER JOIN ${workflow} ON ${workflow.id} = ${workflowBlocks.workflowId}
          WHERE ${workflow.workspaceId} = ${workspaceId} AND ${workflow.archivedAt} IS NULL
            AND ${workflowBlocks.subBlocks}::text LIKE ANY (${patterns})
          UNION ALL
          SELECT ${workflow.id}, ${workflow.name}, sub_blocks.doc, sub_blocks.doc::text, true
          FROM ${workflowDeploymentVersion}
          INNER JOIN ${workflow} ON ${workflow.id} = ${workflowDeploymentVersion.workflowId}
          CROSS JOIN LATERAL (
            SELECT jsonb_path_query_array(${workflowDeploymentVersion.state}::jsonb, '$.blocks.*.subBlocks') AS doc
          ) AS sub_blocks
          WHERE ${workflow.workspaceId} = ${workspaceId} AND ${workflow.archivedAt} IS NULL
            AND ${workflow.isDeployed} AND ${workflowDeploymentVersion.isActive}
            AND ${workflowDeploymentVersion.state}::text LIKE ANY (${patterns})
        )
        SELECT referenced.id AS "resourceId", candidates.id, candidates.name,
          bool_or(NOT candidates.live) AS draft, bool_or(candidates.live) AS live
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
        GROUP BY referenced.id, candidates.id, candidates.name
      `)
    })
  } catch (error) {
    if (getPostgresErrorCode(error) !== QUERY_CANCELED) throw error
    logger.warn('Workspace source in-use scan timed out', { workspaceId, ids: ids.length })
    return null
  }
  for (const row of rows) {
    const list = using.get(row.resourceId) ?? []
    list.push({ id: row.id, name: row.name, draft: row.draft, live: row.live })
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

/**
 * The workflows whose live version this plan replaces or stops before its deletes run: a
 * deployment it writes that publishes the draft, or one it undeploys. Held changes write nothing.
 */
export function liveVersionsReplaced(changes: readonly PlannedChange[]): Set<string> {
  const replaced = new Set<string>()
  for (const change of changes) {
    if (change.kind !== 'deployment' || change.held) continue
    const workflowId = change.detail?.workflowId ?? change.storedId
    if (workflowId === undefined) continue
    if (change.action === 'delete' || change.detail?.deploy === true) replaced.add(workflowId)
  }
  return replaced
}

/**
 * Checks every delete the plan makes against the stored workflows that use the resource. A
 * workflow the directory declares unchanged (`unchanged` lists the keys of each kind sent without
 * files) keeps using it, so the delete is `E_PLAN_REF_DELETED`; one the directory does not declare
 * is named in a warning and counted in the delete's destructive line. A workflow the apply deletes
 * too is no user, and an edited one is judged by the references its compiled source makes (the
 * change's `refs`), unless it is held back (`held`, so the plan must decide holds first): its
 * stored references stay. A deployed workflow whose live version uses the resource keeps running
 * it whatever its draft says, so it is named in the warning too, unless the apply publishes its
 * draft or undeploys it first.
 */
export async function checkDeletesInUse(
  changes: PlannedChange[],
  unchanged: ReadonlyMap<WorkspaceKind, ReadonlySet<string>>,
  workspaceId: string
): Promise<void> {
  // A credential delete only unbinds its key, which leaves every stored workflow using the
  // credential working; an undeploy deletes no resource (its stored id is its workflow's). A
  // delete refused for want of --allow-delete deletes nothing, so it is not scanned: the plan that
  // allows it (the CLI's dry run first) names the workflows. An update that would lose data (a
  // dropped column, a removed option) deletes nothing a workflow names.
  const deleting = changes.filter(
    (change) =>
      change.kind !== 'credential' &&
      change.kind !== 'deployment' &&
      change.storedId !== undefined &&
      change.action === 'delete'
  )
  if (deleting.length === 0) return
  const using = await workflowsUsing(
    workspaceId,
    deleting.flatMap((change) => change.storedId ?? [])
  )
  // Fails closed: a delete whose users could not be checked is refused, never made blind.
  if (using === null) {
    for (const change of deleting) change.diagnostics.push(inUseUncheckedFinding(change))
    return
  }
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
  const replacedLive = liveVersionsReplaced(changes)
  for (const change of deleting) {
    const broken: string[] = []
    for (const user of using.get(change.storedId ?? '') ?? []) {
      if (deletedWorkflows.has(user.id)) continue
      const folder = declared.get(user.id)
      if (user.draft && !folder?.edited) {
        if (folder) {
          change.diagnostics.push(refDeletedFinding({ kind: 'workflow', key: folder.key }, change))
        } else {
          broken.push(`"${user.name}"`)
        }
        continue
      }
      if (user.live && !replacedLive.has(user.id)) broken.push(`"${user.name}" (live version)`)
    }
    if (broken.length === 0) continue
    if (change.destructive) change.destructive.counts.workflows = broken.length
    const listed = broken.slice(0, NAMED_WORKFLOWS).join(', ')
    const more =
      broken.length > NAMED_WORKFLOWS ? ` and ${broken.length - NAMED_WORKFLOWS} more` : ''
    change.diagnostics.push(
      kindFinding(
        change.kind,
        change.key,
        'W_RESOURCE_IN_USE',
        `Deleting ${where(change.kind, change.key)} breaks ${broken.length} stored workflow(s) that use it: ${listed}${more}.`,
        { hint: 'Remove it from those workflows, or keep its declaration.' }
      )
    )
  }
}
