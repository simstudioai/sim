import { db } from '@sim/db'
import { workflow, workflowBlocks, workflowDeploymentVersion, workflowEdges } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { type AnyColumn, and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getTableById } from '@/lib/table/service'
import { getDynamicHandleSubblockId } from '@/lib/workflows/dynamic-handle-topology'
import {
  alwaysEndsAtResponseBlock,
  collectChildWorkflowFindings,
  collectDanglingBlockOutputReferences,
  collectTableBlockFieldIssues,
  collectUnquotedJsonStringReferences,
  collectWorkflowFieldIssues,
  collectWorkflowTableIds,
  hasWorkflowEntryBlock,
  lintEditedWorkflowState,
  type WorkflowLintChildWorkflow,
  type WorkflowLintReport,
  type WorkflowLintTableFieldIssue,
  type WorkflowLintTableSchema,
  type WorkflowLintUnresolvedReference,
  type WorkflowResponseGraph,
} from '@/lib/workflows/editing/lint'
import {
  type AgentToolReferenceValidationOptions,
  collectUnresolvedAgentToolReferences,
  collectUnresolvedReferences,
  UNRESOLVABLE_AT_LINT_NOTE,
} from '@/lib/workflows/editing/validation'
import { collectReferencedWorkflowIds } from '@/lib/workflows/streaming/nested-output-options'
import {
  type ManualRunEntryIssue,
  resolveManualRunEntry,
} from '@/lib/workflows/triggers/manual-run'
import { resolveStartCandidates } from '@/lib/workflows/triggers/triggers'

const logger = createLogger('WorkflowLintReport')

/**
 * Why a report carries no reference findings for a non-human caller.
 *
 * Credential, tool, and skill references resolve against a specific human's
 * grants. A workspace API key has no human subject, and the identity that would
 * stand in for one is the workspace's billing owner — a different person, whose
 * credentials this caller cannot use. Resolving against them would report a
 * reference as resolvable when the workflow cannot in fact reach it, and would
 * disclose which credentials that human holds. So the reference pass is skipped
 * and said to be skipped, rather than answered against the wrong identity.
 */
export const REFERENCES_UNCHECKED_NOTE =
  'Credential, tool, and skill references were not checked because this caller does not act as a human user. Structural and field findings are complete.'

/**
 * A graph with nothing in it lints perfectly clean, which is the wrong signal
 * for a `PUT /state` whose whole effect would be to erase the workflow.
 */
export const EMPTY_GRAPH_NOTE =
  'The graph has no blocks — replacing with this empties the workflow.'

/**
 * Every block has an incoming edge, or none of them is a trigger: the graph
 * may be fully wired and still have nowhere to begin. Not an `orphanBlocks`
 * finding — a cycle of non-trigger blocks has no orphan and no entry.
 */
export const NO_ENTRY_BLOCK_NOTE = 'No entry block: nothing can start this workflow.'

/**
 * What the editor's Run button would refuse. A graph with no manual entry that
 * a chat can still start is a chat workflow, valid for its trigger, so it is
 * not reported; an empty graph has its own note.
 */
function collectManualRunIssue(
  graph: Pick<WorkflowState, 'blocks' | 'edges'>
): ManualRunEntryIssue | null {
  const blocks = graph.blocks ?? {}
  if (Object.keys(blocks).length === 0) return null
  const entry = resolveManualRunEntry(blocks, graph.edges ?? [])
  if (entry.ok) return null
  if (
    entry.issue.reason === 'no-trigger' &&
    resolveStartCandidates(blocks, { execution: 'chat' }).length > 0
  ) {
    return null
  }
  return entry.issue
}

export interface WorkflowLintScope {
  workflowId: string
  workspaceId: string
  /**
   * The human whose grants references resolve against, or `null` when the
   * caller is not acting as one. Never a billing-owner or creator stand-in.
   */
  subjectUserId: string | null
}

export type WorkflowLintTableDiagnostics = Pick<
  WorkflowLintReport,
  'tableFieldIssues' | 'unresolvedReferences' | 'notes'
>

interface WorkflowLintReportOptions extends AgentToolReferenceValidationOptions {
  /** Standalone callers supply table findings from authorized reads and active block inputs. */
  tables?: WorkflowLintTableDiagnostics
  /**
   * Schemas an enclosing write declares for tables it has yet to create or change, by table id
   * (a workspace source apply's dry run): they stand in for the stored schema.
   */
  declaredTables?: ReadonlyMap<string, WorkflowLintTableSchema>
  /**
   * `false` leaves out the iteration-scope check, for a caller whose compile reports it at the
   * source line (a source apply).
   */
  iterationScope?: boolean
  /**
   * The graph is a version a deploy admitted: each child workflow it calls must be deployed too,
   * since a deployed run calls the child's deployed version.
   */
  deployed?: boolean
}

/** Joins a child's graph rows to its `workflow` row while that is live in `workspaceId`. */
function liveChildOf(workflowIdColumn: AnyColumn, workspaceId: string) {
  return and(
    eq(workflow.id, workflowIdColumn),
    eq(workflow.workspaceId, workspaceId),
    isNull(workflow.archivedAt)
  )
}

/**
 * The draft graph of each child in `ids`, by workflow id: only what
 * {@link alwaysEndsAtResponseBlock} reads (each block's type, flag, parent and branch rows, each
 * edge's ends and handle), in one query per table.
 */
async function loadChildDraftGraphs(
  ids: string[],
  workspaceId: string
): Promise<Map<string, WorkflowResponseGraph>> {
  const [blocks, edges] = await Promise.all([
    db
      .select({
        workflowId: workflowBlocks.workflowId,
        id: workflowBlocks.id,
        type: workflowBlocks.type,
        enabled: workflowBlocks.enabled,
        parentId: sql<string | null>`${workflowBlocks.data}->>'parentId'`,
        branchRows: sql<unknown>`coalesce(${workflowBlocks.subBlocks}->'conditions'->'value', ${workflowBlocks.subBlocks}->'routes'->'value')`,
      })
      .from(workflowBlocks)
      .innerJoin(workflow, liveChildOf(workflowBlocks.workflowId, workspaceId))
      .where(inArray(workflowBlocks.workflowId, ids)),
    db
      .select({
        workflowId: workflowEdges.workflowId,
        source: workflowEdges.sourceBlockId,
        target: workflowEdges.targetBlockId,
        sourceHandle: workflowEdges.sourceHandle,
      })
      .from(workflowEdges)
      .innerJoin(workflow, liveChildOf(workflowEdges.workflowId, workspaceId))
      .where(inArray(workflowEdges.workflowId, ids)),
  ])
  const graphs = new Map<
    string,
    { blocks: WorkflowResponseGraph['blocks']; edges: WorkflowResponseGraph['edges'][number][] }
  >()
  const graphOf = (workflowId: string) => {
    const graph = graphs.get(workflowId) ?? { blocks: {}, edges: [] }
    graphs.set(workflowId, graph)
    return graph
  }
  for (const { workflowId, id, type, enabled, parentId, branchRows } of blocks) {
    const branchField = getDynamicHandleSubblockId(type)
    graphOf(workflowId).blocks[id] = {
      type,
      enabled,
      data: { parentId },
      subBlocks: branchField ? { [branchField]: { value: branchRows } } : {},
    }
  }
  for (const { workflowId, ...edge } of edges) graphOf(workflowId).edges.push(edge)
  return graphs
}

/**
 * The graph of each child in `ids` with an active deployment, by workflow id: the blocks and edges
 * of that deployment's snapshot, which a deployed run of the caller calls, in one query.
 */
async function loadChildDeployedGraphs(
  ids: string[],
  workspaceId: string
): Promise<Map<string, WorkflowResponseGraph>> {
  const versions = await db
    .select({
      workflowId: workflowDeploymentVersion.workflowId,
      blocks: sql<
        WorkflowResponseGraph['blocks'] | null
      >`${workflowDeploymentVersion.state}->'blocks'`,
      edges: sql<
        WorkflowResponseGraph['edges'] | null
      >`${workflowDeploymentVersion.state}->'edges'`,
    })
    .from(workflowDeploymentVersion)
    .innerJoin(workflow, liveChildOf(workflowDeploymentVersion.workflowId, workspaceId))
    .where(
      and(
        inArray(workflowDeploymentVersion.workflowId, ids),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
  return new Map(
    versions.map(({ workflowId, blocks, edges }) => [
      workflowId,
      { blocks: blocks ?? {}, edges: edges ?? [] },
    ])
  )
}

/**
 * What the lint checks a call against for each workflow the graph's Workflow blocks call in this
 * workspace, keyed by id: its name, whether it is deployed, and whether every run of it ends at a
 * Response block, judged on the version a run of the caller calls (`deployed`: the child's active
 * deployment; else its draft). A child in another workspace, or archived, is left out: the block's
 * own reference check reports it.
 */
async function loadChildWorkflowsForLint(
  graph: Pick<WorkflowState, 'blocks' | 'edges'>,
  workspaceId: string,
  deployed: boolean
): Promise<Map<string, WorkflowLintChildWorkflow>> {
  const ids = collectReferencedWorkflowIds([graph])
  const children = new Map<string, WorkflowLintChildWorkflow>()
  if (ids.length === 0) return children
  const [rows, graphs] = await Promise.all([
    db
      .select({ id: workflow.id, name: workflow.name, isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(
        and(
          inArray(workflow.id, ids),
          eq(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt)
        )
      ),
    deployed ? loadChildDeployedGraphs(ids, workspaceId) : loadChildDraftGraphs(ids, workspaceId),
  ])
  for (const row of rows) {
    const childGraph = graphs.get(row.id)
    children.set(row.id, {
      name: row.name,
      deployed: row.isDeployed,
      responds: childGraph !== undefined && alwaysEndsAtResponseBlock(childGraph),
    })
  }
  return children
}

/**
 * The live schema of every table the graph's Table blocks are bound to, keyed
 * by table id, or the schema the enclosing write declares for it. A table outside the workspace is left out rather than reported
 * on: the finding names the table, and a block bound to a table this workspace
 * cannot read is a reference problem, not a field problem.
 */
async function loadTableSchemasForLint(
  blocks: Pick<WorkflowState, 'blocks'>['blocks'],
  workspaceId: string,
  declared: ReadonlyMap<string, WorkflowLintTableSchema> | undefined
): Promise<Map<string, WorkflowLintTableSchema>> {
  const tables = new Map<string, WorkflowLintTableSchema>()
  await Promise.all(
    collectWorkflowTableIds(blocks).map(async (tableId) => {
      const schema = declared?.get(tableId)
      if (schema) {
        tables.set(tableId, schema)
        return
      }
      const table = await getTableById(tableId)
      if (!table || table.workspaceId !== workspaceId) return
      tables.set(tableId, {
        name: table.name,
        columnNames: table.schema.columns.map((column) => column.name),
      })
    })
  )
  return tables
}

/**
 * Builds the advisory report published by both graph writes.
 *
 * Shared so `PUT /state` and `POST /operations` cannot drift: an agent that
 * authors a whole graph and one that edits it incrementally need the same
 * findings, and a finding added for one caller must reach the other.
 *
 * Findings never block a write. Reference resolution is best-effort — its
 * collectors read the database, and a failure there must not fail a write that
 * has already been validated — so a collector that throws is logged and its
 * findings omitted rather than propagated.
 * Standalone diagnostics opt into complete lookups instead of treating omitted
 * findings as evidence that the workflow has no issues.
 */
export async function buildWorkflowLintReport(
  graph: Pick<WorkflowState, 'blocks' | 'edges'>,
  scope: WorkflowLintScope,
  options: WorkflowLintReportOptions = {}
): Promise<WorkflowLintReport> {
  if (options.requireComplete && !scope.subjectUserId) {
    throw new Error('Workflow reference checks require a user subject')
  }
  const unresolvedReferences: WorkflowLintUnresolvedReference[] = [
    ...(options.tables?.unresolvedReferences ?? []),
  ]

  // Pure graph checks, so they run for every caller: a dangling block-output
  // reference passes literal text through at run time on the surfaces that
  // do not fail loudly (API bodies, agent prompts), and an unquoted string
  // reference makes a JSON field unparseable only once the block runs.
  unresolvedReferences.push(
    ...collectDanglingBlockOutputReferences(graph, { iterationScope: options.iterationScope }),
    ...collectUnquotedJsonStringReferences(graph)
  )

  // Started before the reference collectors so its lookup overlaps theirs. It settles to `null`
  // rather than rejecting, so a collector below that throws first leaves no rejection unhandled.
  const deployed = options.deployed === true
  const childFindings = loadChildWorkflowsForLint(graph, scope.workspaceId, deployed).then(
    (children) => collectChildWorkflowFindings(graph, children, { deployed }),
    (error: unknown) => {
      logger.warn('Child workflow lint failed', {
        workflowId: scope.workflowId,
        error: getErrorMessage(error),
      })
      return null
    }
  )

  if (scope.subjectUserId) {
    for (const collect of [collectUnresolvedReferences, collectUnresolvedAgentToolReferences]) {
      try {
        /**
         * Reported only through `lint`. These collectors are read-only, so the
         * values they flag stay persisted — pushing them into
         * `inputValidationErrors` as well would double-report them, and falsely,
         * since that field means "dropped rather than persisted".
         */
        const references = await collect(
          graph,
          {
            userId: scope.subjectUserId,
            workspaceId: scope.workspaceId,
          },
          options
        )
        unresolvedReferences.push(...references)
      } catch (error) {
        logger.warn('Reference resolution lint failed', {
          workflowId: scope.workflowId,
          error: getErrorMessage(error),
        })
        if (options.requireComplete) {
          throw new Error(
            'Workflow reference checks could not complete; retry when lookup is available'
          )
        }
      }
    }
  }

  const children = await childFindings
  if (children === null && options.requireComplete) {
    throw new Error(
      'Workflow child workflow checks could not complete; retry when lookup is available'
    )
  }
  unresolvedReferences.push(...(children ?? []))

  /** Standalone diagnostics have already read tables under application authorization. */
  let tableFieldIssues: WorkflowLintTableFieldIssue[] = options.tables?.tableFieldIssues ?? []
  if (!options.tables) {
    try {
      tableFieldIssues = collectTableBlockFieldIssues(
        graph.blocks,
        await loadTableSchemasForLint(graph.blocks, scope.workspaceId, options.declaredTables)
      )
    } catch (error) {
      logger.warn('Table field lint failed', {
        workflowId: scope.workflowId,
        error: getErrorMessage(error),
      })
      if (options.requireComplete) {
        throw new Error(
          'Workflow table schema checks could not complete; retry when lookup is available'
        )
      }
    }
  }

  const graphLint = lintEditedWorkflowState(graph)

  const notes: string[] = [...(options.tables?.notes ?? [])]
  if (!scope.subjectUserId) notes.push(REFERENCES_UNCHECKED_NOTE)
  if (unresolvedReferences.length > 0) notes.push(UNRESOLVABLE_AT_LINT_NOTE)
  if (Object.keys(graph.blocks ?? {}).length === 0) {
    notes.push(EMPTY_GRAPH_NOTE)
  } else if (graphLint.sources.length === 0 || !hasWorkflowEntryBlock(graph.blocks)) {
    notes.push(NO_ENTRY_BLOCK_NOTE)
  }

  /**
   * `fieldIssues`, `unresolvedReferences`, `tableFieldIssues`, and `notes` are
   * assigned after the graph-lint spread and that is safe: {@link lintEditedWorkflowState} returns
   * `WorkflowLintResult`, which declares none of them, so the assignment can
   * never discard a finding the linter made.
   */
  return {
    ...graphLint,
    fieldIssues: collectWorkflowFieldIssues(graph.blocks),
    unresolvedReferences,
    tableFieldIssues,
    manualRunIssue: collectManualRunIssue(graph),
    notes,
  }
}
