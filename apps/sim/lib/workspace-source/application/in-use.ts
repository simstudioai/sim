/**
 * Stored workflows that still use a resource a plan deletes. The check reads the workflows as the
 * server stores them, by resource id, never the text the directory sent: the CLI sends an
 * unchanged workflow folder without its `workflow.ts`, so the text names nothing.
 */
import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { KIND_DIRS } from '@sim/workspace-code'
import { type WorkflowDecl, workflowSourceBase } from '@sim/workspace-code/kinds/workflow'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { finding } from '@/lib/workspace-source/application/findings'
import type { PlannedChange } from '@/lib/workspace-source/application/types'

/** Workflows a warning names before it only counts the rest. */
const NAMED_WORKFLOWS = 5

interface UsingWorkflow {
  id: string
  name: string
}

/**
 * The live workflows of the workspace whose blocks name any of `ids`, by resource id. A block
 * names a resource by its id in a sub-block value (alone, in a list, or comma-joined), so a match
 * anywhere in the sub-block values counts; ids are opaque and unique, so it never matches by
 * accident.
 */
async function workflowsUsing(
  workspaceId: string,
  ids: readonly string[]
): Promise<Map<string, UsingWorkflow[]>> {
  const using = new Map<string, UsingWorkflow[]>()
  if (ids.length === 0) return using
  const referenced = sql`unnest(ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )}]::text[]) AS referenced(id)`
  const rows = await db
    .selectDistinct({
      resourceId: sql<string>`referenced.id`,
      id: workflow.id,
      name: workflow.name,
    })
    .from(workflowBlocks)
    .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
    .innerJoin(referenced, sql`strpos(${workflowBlocks.subBlocks}::text, referenced.id) > 0`)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
  for (const row of rows) {
    const list = using.get(row.resourceId) ?? []
    list.push({ id: row.id, name: row.name })
    using.set(row.resourceId, list)
  }
  return using
}

/**
 * Checks every delete the plan makes (or refuses for want of `--allow-delete`) against the stored
 * workflows that use the resource. A workflow the directory declares unchanged keeps using it, so
 * the delete is `E_PLAN_REF_DELETED`; one the directory does not declare is named in a warning
 * and counted in the delete's destructive line. A workflow the apply deletes too is no user, and
 * an edited one is judged by the references its sent text makes.
 */
export async function checkDeletesInUse(
  changes: PlannedChange[],
  declaredWorkflows: ReadonlyMap<string, unknown>,
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
  const deletedWorkflows = new Set(
    changes.flatMap((change) =>
      change.kind === 'workflow' && change.action === 'delete' ? (change.storedId ?? []) : []
    )
  )
  const declared = new Map<string, { key: string; edited: boolean }>()
  for (const [key, decl] of declaredWorkflows as ReadonlyMap<string, WorkflowDecl>) {
    const base = workflowSourceBase(decl)
    if (base?.workspaceId !== workspaceId) continue
    declared.set(base.workflowId, { key, edited: Object.keys(decl.files).length > 0 })
  }
  for (const change of deleting) {
    const where = `${KIND_DIRS[change.kind]}/${change.key}`
    const undeclared: UsingWorkflow[] = []
    for (const user of using.get(change.storedId ?? '') ?? []) {
      if (deletedWorkflows.has(user.id)) continue
      const folder = declared.get(user.id)
      if (folder?.edited) continue
      if (folder && change.action === 'delete') {
        change.diagnostics.push(
          finding(
            'E_PLAN_REF_DELETED',
            `workflows/${folder.key} uses ${change.kind} "${change.key}", which this apply deletes.`,
            {
              kind: 'workflow',
              key: folder.key,
              hint: `Keep ${where}, or stop using it first.`,
            }
          )
        )
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
      finding(
        'W_RESOURCE_IN_USE',
        `Deleting ${where} breaks ${undeclared.length} stored workflow(s) that use it: ${listed}${more}.`,
        {
          hint: 'Remove it from those workflows, or keep its declaration.',
          kind: change.kind,
          key: change.key,
        }
      )
    )
  }
}
