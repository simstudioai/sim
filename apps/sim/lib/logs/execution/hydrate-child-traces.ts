import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { inArray } from 'drizzle-orm'
import { flattenWorkflowChildren } from '@/lib/logs/execution/trace-spans/span-factory'
import {
  materializeExecutionDataForDisplay,
  stripSpanCosts,
} from '@/lib/logs/execution/trace-store'
import type { TraceSpan } from '@/lib/logs/types'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('HydrateChildTraces')

/**
 * How many invocation boundaries deep to follow. A hydrated child may itself
 * contain custom blocks, so each level costs another query + materialization.
 */
const DEFAULT_MAX_DEPTH = 3

/** Hard cap on child log rows materialized for one read, across all depths. */
const DEFAULT_MAX_ROWS = 25

/** Why a child run was not joined into the parent's trace. */
export interface ChildTraceDropCounts {
  /** Viewer has no access to the child's source workspace. */
  denied: number
  /** No child log row, or it carries no spans (in flight, pruned, never written). */
  missing: number
  /** Boundary sat deeper than `maxDepth`. */
  depthLimited: number
  /** `maxRows` was already exhausted by shallower boundaries. */
  rowLimited: number
  /** The child-log lookup itself failed, so access was never determined. */
  failed: number
}

export interface HydrateChildTracesOptions {
  /** The user reading the log. Every child workspace is authorized against them. */
  viewerUserId: string
  maxDepth?: number
  maxRows?: number
}

export interface HydrateChildTracesResult {
  hydrated: number
  dropped: ChildTraceDropCounts
}

interface ChildLogRow {
  executionId: string
  workspaceId: string | null
  workflowId: string | null
  stateSnapshotId: string | null
  executionData: unknown
}

/**
 * Marks boundaries hydration never attempted (past a cap, or the lookup failed).
 * Without this an unexpanded boundary is indistinguishable from a leaf block, so a
 * partial trace would read as a complete one.
 */
function markTruncated(spans: TraceSpan[]): void {
  for (const span of spans) span.childTraceAccess = 'truncated'
}

/** Spans carrying a custom-block boundary handle, anywhere in one tree. */
function collectBoundarySpans(spans: TraceSpan[], into: TraceSpan[]): void {
  for (const span of spans) {
    if (span.childExecutionId) into.push(span)
    if (span.children?.length) collectBoundarySpans(span.children, into)
  }
}

/**
 * Joins a custom block's child run into its parent's trace, so an orchestrator
 * workflow's log shows the whole cross-workspace execution in one waterfall.
 *
 * The custom-block boundary deliberately keeps the child's spans out of the
 * parent's persisted log — they belong to the child's own log row in the SOURCE
 * workspace, and a custom block is org-wide, so a consumer must not be handed
 * another team's block internals by default. Only the child's opaque execution id
 * is persisted on the parent span; the join happens HERE, at read time, and only
 * after the *viewer* has been authorized against the child's workspace. The
 * authorization decision therefore follows the person reading rather than a flag
 * set when the block was published, and it re-evaluates on every read.
 *
 * Mutates `spans` in place — callers pass a freshly materialized, request-local
 * tree, and copying it would double the peak memory of a large trace.
 *
 * Never throws: a failure to join degrades to an unexpanded boundary span rather
 * than failing the parent's log detail.
 */
export async function hydrateChildTraces(
  spans: TraceSpan[],
  options: HydrateChildTracesOptions
): Promise<HydrateChildTracesResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const dropped: ChildTraceDropCounts = {
    denied: 0,
    missing: 0,
    depthLimited: 0,
    rowLimited: 0,
    failed: 0,
  }
  let hydrated = 0
  let rowBudget = maxRows

  // Execution ids already joined in this read. Guards against a malformed tree
  // pointing back at an ancestor run and looping forever.
  const seen = new Set<string>()
  // One access decision per workspace, reused across every boundary that resolves
  // to it — a parent with 30 custom-block spans usually spans 1-2 workspaces.
  const accessByWorkspace = new Map<string, boolean>()

  let frontier = spans
  for (let depth = 0; ; depth++) {
    const boundarySpans: TraceSpan[] = []
    collectBoundarySpans(frontier, boundarySpans)
    const pending = boundarySpans.filter((span) => !seen.has(span.childExecutionId as string))
    if (pending.length === 0) break

    if (depth >= maxDepth) {
      dropped.depthLimited += pending.length
      markTruncated(pending)
      break
    }

    const admitted = pending.slice(0, Math.max(0, rowBudget))
    const rowLimited = pending.slice(admitted.length)
    dropped.rowLimited += rowLimited.length
    markTruncated(rowLimited)
    if (admitted.length === 0) break
    rowBudget -= admitted.length

    const executionIds = Array.from(new Set(admitted.map((s) => s.childExecutionId as string)))
    for (const id of executionIds) seen.add(id)

    let rows: ChildLogRow[] = []
    try {
      rows = await db
        .select({
          executionId: workflowExecutionLogs.executionId,
          workspaceId: workflowExecutionLogs.workspaceId,
          workflowId: workflowExecutionLogs.workflowId,
          stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
          executionData: workflowExecutionLogs.executionData,
        })
        .from(workflowExecutionLogs)
        .where(inArray(workflowExecutionLogs.executionId, executionIds))
    } catch (error) {
      logger.warn('Failed to load custom-block child runs; leaving boundaries unexpanded', {
        count: executionIds.length,
        error: getErrorMessage(error),
      })
      dropped.failed += admitted.length
      markTruncated(admitted)
      break
    }

    const rowByExecutionId = new Map(rows.map((row) => [row.executionId, row]))

    const workspacesToCheck = Array.from(
      new Set(
        rows
          .map((row) => row.workspaceId)
          .filter((id): id is string => typeof id === 'string' && !accessByWorkspace.has(id))
      )
    )
    await Promise.all(
      workspacesToCheck.map(async (workspaceId) => {
        try {
          const access = await checkWorkspaceAccess(workspaceId, options.viewerUserId)
          accessByWorkspace.set(workspaceId, access.hasAccess === true)
        } catch {
          // Fail closed: an unresolvable access decision keeps the boundary shut.
          accessByWorkspace.set(workspaceId, false)
        }
      })
    )

    const nextFrontier: TraceSpan[] = []
    await Promise.all(
      admitted.map(async (span) => {
        const executionId = span.childExecutionId as string
        const row = rowByExecutionId.get(executionId)
        if (!row) {
          span.childTraceAccess = 'missing'
          dropped.missing++
          return
        }
        if (!row.workspaceId || accessByWorkspace.get(row.workspaceId) !== true) {
          span.childTraceAccess = 'denied'
          dropped.denied++
          return
        }

        let childSpans: TraceSpan[] = []
        try {
          const executionData = await materializeExecutionDataForDisplay(
            row.executionData as Record<string, unknown> | null,
            {
              workspaceId: row.workspaceId,
              workflowId: row.workflowId,
              executionId: row.executionId,
              userId: options.viewerUserId,
            }
          )
          const raw = executionData?.traceSpans
          if (Array.isArray(raw)) childSpans = raw as TraceSpan[]
        } catch (error) {
          logger.warn('Failed to materialize a custom-block child run', {
            executionId,
            error: getErrorMessage(error),
          })
        }

        if (childSpans.length === 0) {
          span.childTraceAccess = 'missing'
          dropped.missing++
          return
        }

        // The same flattening the in-process workflow-in-workflow path uses, so a
        // cross-workspace child nests identically to a local one.
        const children = flattenWorkflowChildren(childSpans)
        // The child's spend is billed to the SOURCE workspace and was never rolled
        // into this run's total, so leaving per-span cost here would make the
        // waterfall's numbers contradict the run cost shown above it.
        stripSpanCosts(children)

        span.children = children
        span.childTraceAccess = 'granted'
        // Only now that the viewer is authorized does the child's graph snapshot
        // become theirs to see. Stamping it at write time would have exposed the
        // source workflow's structure to every consumer.
        if (row.stateSnapshotId) span.childWorkflowSnapshotId = row.stateSnapshotId
        hydrated++
        nextFrontier.push(...children)
      })
    )

    if (nextFrontier.length === 0) break
    frontier = nextFrontier
  }

  const totalDropped =
    dropped.denied + dropped.missing + dropped.depthLimited + dropped.rowLimited + dropped.failed
  if (totalDropped > 0) {
    logger.info('Custom-block child runs not joined into parent trace', { hydrated, ...dropped })
  }

  return { hydrated, dropped }
}
