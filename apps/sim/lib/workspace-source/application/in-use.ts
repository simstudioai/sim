/**
 * Stored workflows that still use a resource a plan deletes. The check reads the workflows as the
 * server stores them, by resource id, never the text the directory sent: a workflow folder sent
 * unchanged carries no files (its codec's `isUnchanged`), so its text names nothing.
 */
import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import type { WorkspaceKind } from '@sim/workspace-code'
import { sql } from 'drizzle-orm'
import { kindFinding, refDeletedFinding, where } from '@/lib/workspace-source/application/findings'
import type { PlannedChange } from '@/lib/workspace-source/application/types'

/** Workflows a warning names before it only counts the rest. */
const NAMED_WORKFLOWS = 5

interface UsingWorkflow {
  id: string
  name: string
}

/**
 * The live workflows of the workspace whose blocks name any of `ids`, by resource id. A block
 * names a resource by its id as a whole sub-block value, as an item of a list, or as one part of
 * a comma-joined value, at any depth (a tool's parameters included), the forms a workflow source
 * read lifts to resource keys. An id that only appears inside other text, such as a prompt that
 * mentions it, names nothing. Each block's sub-blocks are cast to text once (a materialized CTE)
 * to find the candidates cheaply; only those are walked value by value.
 */
export async function workflowsUsing(
  workspaceId: string,
  ids: readonly string[]
): Promise<Map<string, UsingWorkflow[]>> {
  const using = new Map<string, UsingWorkflow[]>()
  if (ids.length === 0) return using
  const rows = await db.execute<{ resourceId: string; id: string; name: string }>(sql`
    WITH blocks AS MATERIALIZED (
      SELECT ${workflow.id} AS id, ${workflow.name} AS name, ${workflowBlocks.subBlocks} AS doc,
        ${workflowBlocks.subBlocks}::text AS text
      FROM ${workflowBlocks}
      INNER JOIN ${workflow} ON ${workflow.id} = ${workflowBlocks.workflowId}
      WHERE ${workflow.workspaceId} = ${workspaceId} AND ${workflow.archivedAt} IS NULL
    )
    SELECT DISTINCT referenced.id AS "resourceId", blocks.id, blocks.name
    FROM blocks
    INNER JOIN unnest(ARRAY[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    )}]::text[]) AS referenced(id) ON strpos(blocks.text, referenced.id) > 0
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_path_query(blocks.doc, 'strict $.**') AS leaf(value)
      WHERE jsonb_typeof(leaf.value) = 'string'
        AND referenced.id IN (
          SELECT btrim(part) FROM unnest(string_to_array(leaf.value #>> '{}', ',')) AS part
        )
    )
  `)
  for (const row of rows) {
    const list = using.get(row.resourceId) ?? []
    list.push({ id: row.id, name: row.name })
    using.set(row.resourceId, list)
  }
  return using
}

/**
 * Checks every delete the plan makes (or refuses for want of `--allow-delete`) against the stored
 * workflows that use the resource. A workflow the directory declares unchanged (`unchanged` lists
 * the keys of each kind sent without files) keeps using it, so the delete is
 * `E_PLAN_REF_DELETED`; one the directory does not declare is named in a warning and counted in
 * the delete's destructive line. A workflow the apply deletes too is no user, and an edited one is
 * judged by the references its compiled source makes (the change's `refs`).
 */
export async function checkDeletesInUse(
  changes: PlannedChange[],
  unchanged: ReadonlyMap<WorkspaceKind, ReadonlySet<string>>,
  workspaceId: string
): Promise<void> {
  const deleting = changes.filter(
    (change) =>
      change.kind !== 'workflow' &&
      change.storedId !== undefined &&
      (change.action === 'delete' ||
        change.diagnostics.some((finding) => finding.code === 'E_APPLY_DELETE_NOT_ALLOWED'))
  )
  if (deleting.length === 0) return
  const using = await workflowsUsing(
    workspaceId,
    deleting.flatMap((change) => change.storedId ?? [])
  )
  const deletedWorkflows = new Set<string>()
  // The workflows the directory declares, by stored id.
  const declared = new Map<string, { key: string; edited: boolean }>()
  for (const change of changes) {
    if (change.kind !== 'workflow' || change.storedId === undefined) continue
    if (change.action === 'delete') deletedWorkflows.add(change.storedId)
    else {
      const edited = !unchanged.get('workflow')?.has(change.key)
      declared.set(change.storedId, { key: change.key, edited })
    }
  }
  for (const change of deleting) {
    const undeclared: UsingWorkflow[] = []
    for (const user of using.get(change.storedId ?? '') ?? []) {
      if (deletedWorkflows.has(user.id)) continue
      const folder = declared.get(user.id)
      if (folder?.edited) continue
      if (folder && change.action === 'delete') {
        change.diagnostics.push(refDeletedFinding({ kind: 'workflow', key: folder.key }, change))
        continue
      }
      undeclared.push(user)
    }
    if (undeclared.length === 0) continue
    if (change.destructive) change.destructive.counts.workflows = undeclared.length
    const listed = undeclared
      .slice(0, NAMED_WORKFLOWS)
      .map((user) => `"${user.name}"`)
      .join(', ')
    const more =
      undeclared.length > NAMED_WORKFLOWS ? ` and ${undeclared.length - NAMED_WORKFLOWS} more` : ''
    change.diagnostics.push(
      kindFinding(
        change.kind,
        change.key,
        'W_RESOURCE_IN_USE',
        `Deleting ${where(change.kind, change.key)} breaks ${undeclared.length} stored workflow(s) that use it: ${listed}${more}.`,
        { hint: 'Remove it from those workflows, or keep its declaration.' }
      )
    )
  }
}
