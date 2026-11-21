/**
 * Workflows that still write a table column by the name a plan renames. A row write, filter or
 * sort names a column by its name, so after the rename the run drops the cell (or matches
 * nothing); the plan warns on each block, at the line its workflow file writes the old name when
 * the directory declares that workflow. A workflow folder the apply evaluates is checked by its own
 * lint against the declared columns, so only workflows the apply leaves as stored are scanned here.
 */
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { escapeRegExp } from '@sim/utils/string'
import { splitLines } from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { workflowFolder } from '@sim/workspace-code/kinds/workflow'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { collectTableBlockFieldIssues } from '@/lib/workflows/editing/lint'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'
import { finding, where } from '@/lib/workspace-source/application/findings'
import { liveVersionsReplaced, workflowsUsing } from '@/lib/workspace-source/application/in-use'
import type { TablePlan } from '@/lib/workspace-source/application/kinds/table/adapter'
import type {
  PlanContext,
  PlannedChange,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/** Workflows whose draft, source or live version the check reads at once. */
const READ_CONCURRENCY = 4

/** A table this plan renames columns of: its id, name, and each old name → new name. */
interface RenamingTable {
  change: PlannedChange
  tableId: string
  tableName: string
  columnNames: string[]
  renamed: Map<string, string>
}

function renamingTables(changes: readonly PlannedChange[]): RenamingTable[] {
  return changes.flatMap((change) => {
    if (change.kind !== 'table' || change.held || change.storedId === undefined) return []
    const plan = change.detail as TablePlan | undefined
    const renamed = new Map(
      (plan?.changes?.renamedColumns ?? []).map(({ from, to }) => [from, to] as const)
    )
    if (renamed.size === 0 || !plan?.changes) return []
    return [
      {
        change,
        tableId: change.storedId,
        tableName: plan.changes.table.name ?? change.key,
        columnNames: plan.changes.columnNames,
        renamed,
      },
    ]
  })
}

/**
 * The 1-based line and column of the first `name` key written after the declaration of block
 * `blockName` in `text`, else of the declaration itself; `undefined` when neither is found.
 */
function locateWrite(
  text: string,
  blockName: string,
  name: string
): { line: number; column: number } | undefined {
  const lines = splitLines(text)
  const quoted = [`'${blockName}'`, `"${blockName}"`]
  const declaration = lines.findIndex((line) => quoted.some((name) => line.includes(name)))
  if (declaration === -1) return undefined
  const keyPattern = new RegExp(`(^|[\\s{,])(['"]?)${escapeRegExp(name)}\\2\\s*:`)
  for (let index = declaration; index < lines.length; index++) {
    const match = keyPattern.exec(lines[index])
    if (match) return { line: index + 1, column: match.index + match[1].length + 1 }
  }
  return { line: declaration + 1, column: 1 }
}

/** The live version of `workflowId`'s deployment, or `null` when it has none. */
async function liveBlocks(workflowId: string) {
  try {
    return (await loadDeployedWorkflowState(workflowId)).blocks
  } catch (error) {
    if (error instanceof NoActiveDeploymentError) return null
    throw error
  }
}

/**
 * Warns `W_TABLE_COLUMN_RENAMED_IN_USE` on each table change that renames a column some stored
 * workflow's Table block still writes, filters or sorts by the old name: one finding per block,
 * naming the workflow and the block, pinned to the declared workflow's file and line. A deployed
 * workflow's live version runs apart from its draft, so it is checked too (an evaluated draft
 * included), unless the apply publishes the draft or undeploys it.
 */
export async function checkColumnRenamesInUse(
  changes: readonly PlannedChange[],
  ctx: PlanContext
): Promise<void> {
  const tables = renamingTables(changes)
  if (tables.length === 0) return
  const using = await workflowsUsing(
    ctx.workspace.workspaceId,
    tables.map((table) => table.tableId)
  )
  if (using === null) return
  /** Declared workflows by stored id: their folder key, and whether the apply evaluates them. */
  const declared = new Map<string, { key: string; evaluated: boolean }>()
  for (const change of changes) {
    if (change.kind !== 'workflow' || change.storedId === undefined) continue
    declared.set(change.storedId, { key: change.key, evaluated: change.refs !== undefined })
  }
  const replacedLive = liveVersionsReplaced(changes)
  const deleted = new Set(
    changes.flatMap((c) =>
      c.kind === 'workflow' && c.action === 'delete' && c.storedId !== undefined ? [c.storedId] : []
    )
  )
  const checks = tables.flatMap((table) => {
    const columns = new Map([
      [table.tableId, { name: table.tableName, columnNames: table.columnNames }],
    ])
    return (using.get(table.tableId) ?? [])
      .filter((workflow) => !deleted.has(workflow.id))
      .map((workflow) => ({ table, columns, workflow }))
  })
  const found = await mapWithConcurrency(checks, READ_CONCURRENCY, async (check) => {
    const { table, columns, workflow } = check
    const findings: WorkspaceSourceDiagnostic[] = []
    const folder = declared.get(workflow.id)
    /** `blockId:field` of each finding already made from the draft. */
    const reported = new Set<string>()
    if (workflow.draft && !folder?.evaluated) {
      const loaded = await loadWorkflowFromNormalizedTables(workflow.id)
      const issues = loaded
        ? collectTableBlockFieldIssues(loaded.blocks, columns).filter((issue) =>
            table.renamed.has(issue.field)
          )
        : []
      const text =
        folder && issues.length > 0
          ? (
              await readWorkflowSource.execute({
                principal: ctx.principal,
                input: { workflowId: workflow.id, plan: true },
              })
            ).files[SOURCE_ENTRY_FILE]
          : undefined
      for (const issue of issues) {
        reported.add(`${issue.blockId}:${issue.field}`)
        const renamedTo = table.renamed.get(issue.field)
        const blockName = issue.blockName ?? issue.blockId
        const at = text !== undefined ? locateWrite(text, blockName, issue.field) : undefined
        findings.push(
          finding(
            'W_TABLE_COLUMN_RENAMED_IN_USE',
            `${where('table', table.change.key)} renames column "${issue.field}" to "${renamedTo}", but block "${blockName}" of workflow "${workflow.name}" still ${issue.rowWrite ? 'writes' : 'reads'} "${issue.field}"; the run drops it.`,
            {
              hint: `Write "${renamedTo}" in that block${folder ? ` (${workflowFolder(folder.key)}/${SOURCE_ENTRY_FILE})` : ''}, in this apply or right after it.`,
              ...(folder
                ? { file: `${workflowFolder(folder.key)}/${SOURCE_ENTRY_FILE}`, ...(at ?? {}) }
                : {}),
              kind: 'table',
              key: table.change.key,
            }
          )
        )
      }
    }
    if (!workflow.live || replacedLive.has(workflow.id)) return { table, findings }
    const live = await liveBlocks(workflow.id)
    if (!live) return { table, findings }
    for (const issue of collectTableBlockFieldIssues(live, columns)) {
      if (!table.renamed.has(issue.field) || reported.has(`${issue.blockId}:${issue.field}`)) {
        continue
      }
      const renamedTo = table.renamed.get(issue.field)
      const blockName = issue.blockName ?? issue.blockId
      findings.push(
        finding(
          'W_TABLE_COLUMN_RENAMED_IN_USE',
          `${where('table', table.change.key)} renames column "${issue.field}" to "${renamedTo}", but block "${blockName}" of workflow "${workflow.name}" (live version) still ${issue.rowWrite ? 'writes' : 'reads'} "${issue.field}"; its runs drop it until the workflow is deployed again.`,
          {
            hint: `Write "${renamedTo}" in that block and deploy the workflow (\`deployments/<key>.ts\` with live: 'draft'), in this apply or right after it.`,
            kind: 'table',
            key: table.change.key,
          }
        )
      )
    }
    return { table, findings }
  })
  for (const { table, findings } of found) table.change.diagnostics.push(...findings)
}
