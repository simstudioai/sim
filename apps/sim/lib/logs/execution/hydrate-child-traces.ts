import { db } from '@sim/db'
import { customBlock, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { inArray } from 'drizzle-orm'
import { flattenWorkflowChildren } from '@/lib/logs/execution/trace-spans/span-factory'
import {
  materializeExecutionDataForDisplay,
  stripSpanCosts,
} from '@/lib/logs/execution/trace-store'
import type { TraceSpan } from '@/lib/logs/types'

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
  /** No child log row, or it carries no spans (in flight, pruned, never written). */
  missing: number
  /** Boundary sat deeper than `maxDepth`. */
  depthLimited: number
  /** `maxRows` was already exhausted by shallower boundaries. */
  rowLimited: number
  /** The block's publisher has not opened its runs to consumers. */
  policyClosed: number
  /** The child-log lookup itself failed, so nothing could be joined. */
  failed: number
}

export interface HydrateChildTracesOptions {
  /**
   * The user reading the log. NOT an authorization input — the only policy is the
   * publisher's, and it is the same answer for every reader. Carried so large-value
   * materialization and secret projection have an owner to attribute their reads to.
   */
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
 * There is deliberately no check on the READER: whether a block's runs may be shown
 * to consumers is the publisher's org-wide decision and is the same answer for
 * everyone. That decision is read here, live, per boundary — not inferred from the
 * handle's presence.
 *
 * Reading it live rather than trusting the handle is what makes the policy safe to
 * apply to logs that already exist. A handle persisted before the policy existed
 * meant something else entirely ("a child ran; authorize the reader"), and treating
 * it as consent would hand out the internals of every block whose publisher never
 * opted in. It also means turning the policy OFF closes the runs already recorded,
 * which is what a governance switch has to do to be worth anything.
 *
 * The two halves are not redundant. The handler withholds the handle at write time,
 * so a run executed while the block was closed stays closed forever, even if the
 * publisher opens the block later; this check then decides whether the runs that DO
 * carry a handle may still be shown.
 *
 * The consequence is deliberate and worth stating: for an opted-in block, anyone who
 * can read the consuming workflow's log sees the source workflow's block names,
 * inputs, outputs, and prompts — including consumers with no access to the source
 * workspace. That is what the publisher turned on.
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
    missing: 0,
    depthLimited: 0,
    rowLimited: 0,
    policyClosed: 0,
    failed: 0,
  }
  let hydrated = 0
  let rowBudget = maxRows

  // Execution ids already joined in this read. Guards against a malformed tree
  // pointing back at an ancestor run and looping forever.
  const seen = new Set<string>()
  // One policy read per source workflow, reused across every boundary that resolves
  // to it — a parent with 30 custom-block spans usually spans 1-2 blocks.
  const policyByWorkflowId = new Map<string, boolean>()

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

    // `custom_block.workflow_id` is unique (publish enforces one block per workflow),
    // so the child run's own workflow identifies the block whose policy governs it.
    // This works for an Agent-tool boundary too, whose span carries no block type.
    const workflowIdsToRead = Array.from(
      new Set(
        rows
          .map((row) => row.workflowId)
          .filter((id): id is string => typeof id === 'string' && !policyByWorkflowId.has(id))
      )
    )
    if (workflowIdsToRead.length > 0) {
      try {
        const blocks = await db
          .select({
            workflowId: customBlock.workflowId,
            traceChildRuns: customBlock.traceChildRuns,
          })
          .from(customBlock)
          .where(inArray(customBlock.workflowId, workflowIdsToRead))
        // Seeded closed first, so a workflow with no custom block row — unpublished,
        // or a block since deleted — has no publisher left to consent and stays shut.
        for (const id of workflowIdsToRead) policyByWorkflowId.set(id, false)
        for (const block of blocks) policyByWorkflowId.set(block.workflowId, block.traceChildRuns)
      } catch (error) {
        logger.warn('Failed to read custom-block trace policy; leaving boundaries unexpanded', {
          count: workflowIdsToRead.length,
          error: getErrorMessage(error),
        })
        for (const id of workflowIdsToRead) policyByWorkflowId.set(id, false)
      }
    }

    const nextFrontier: TraceSpan[] = []
    await Promise.all(
      admitted.map(async (span) => {
        const executionId = span.childExecutionId as string
        const row = rowByExecutionId.get(executionId)
        // No row, or a row whose workspace is gone: large-value storage keys are
        // workspace-scoped, so an orphaned row has nothing materializable either way.
        if (!row?.workspaceId) {
          span.childTraceAccess = 'missing'
          dropped.missing++
          return
        }
        if (!row.workflowId || policyByWorkflowId.get(row.workflowId) !== true) {
          // Same verdict the write path records on a closed block, so a reader cannot
          // tell whether the policy shut at run time or since.
          span.childTraceAccess = 'disabled'
          dropped.policyClosed++
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
        // Carried alongside the joined spans so canvas drill-down works for the same
        // reader, on the same permission.
        if (row.stateSnapshotId) span.childWorkflowSnapshotId = row.stateSnapshotId
        hydrated++
        nextFrontier.push(...children)
      })
    )

    if (nextFrontier.length === 0) break
    frontier = nextFrontier
  }

  // Summed from the struct rather than a hand-listed set of fields, which silently
  // goes stale the moment a counter is added — `policyClosed` was already missing
  // from such a list, and it is the commonest drop of all now that a handle written
  // before the policy existed refuses here.
  const totalDropped = Object.values(dropped).reduce((sum, count) => sum + count, 0)
  if (totalDropped > 0) {
    logger.info('Custom-block child runs not joined into parent trace', { hydrated, ...dropped })
  }

  return { hydrated, dropped }
}
