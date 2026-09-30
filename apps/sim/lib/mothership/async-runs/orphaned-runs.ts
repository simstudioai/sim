import { db } from '@sim/db'
import {
  type CopilotRunStatus,
  copilotChats,
  copilotOrganizationRequestStops,
  copilotRequestStops,
  copilotRuns,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { getChatStreamLockOwners } from '@/lib/mothership/request/session/abort'
import { findStreamsWithReplay } from '@/lib/mothership/request/session/buffer'

const logger = createLogger('OrphanedCopilotRuns')

const TERMINAL_RUN_STATUSES: CopilotRunStatus[] = ['complete', 'error', 'cancelled']
/** Listed positively so the sweep's scan stays on the status index once few runs are open. */
const UNFINISHED_RUN_STATUSES: CopilotRunStatus[] = [
  'active',
  'paused_waiting_for_tool',
  'resuming',
]

/**
 * How long a leased run must go without a status write before the sweep may settle it.
 *
 * This is a recovery window, not a liveness test, and is independent of any run
 * deadline. Liveness comes only from the chat lock: a live controller renews it by
 * heartbeat for as long as it runs, however long that is, and a run whose stream holds
 * the lock is never settled. For a run with no lock holder, this window and the replay
 * buffer's `:seq` key (whose TTL each write renews, `COPILOT_STREAM_TTL_SECONDS`,
 * one hour by default) leave a reconnect time to resume it; the sweep waits for both.
 * A TTL configured below this window shortens only that resume window, never safety.
 */
export const ORPHANED_RUN_GRACE_MS = 60 * 60 * 1000

/**
 * Runs admitted by code predating the current tool-execution protocol. Every run the
 * current code admits records the current version, so once a deploy has replaced the
 * processes that admitted these, none can be live; the age only leaves room for a
 * rollout. A current run without a lease (a headless turn) is never swept: it has no
 * liveness signal and its own lifecycle always settles it.
 */
export const LEGACY_RUN_GRACE_MS = 24 * 60 * 60 * 1000

export const ORPHANED_RUN_ERROR = 'This response was interrupted before it finished.'
export const LEGACY_RUN_ERROR = 'Run was never finalized (pre-lease run).'

const SWEEP_BATCH_SIZE = 500
const SWEEP_MAX_ROWS_PER_RUN = 5_000
/** Spaces full batches so a backlog drains without a sustained burst of synchronous commits. */
const SWEEP_BATCH_PAUSE_MS = 200

const controllerToken = sql<string | null>`${copilotRuns.requestContext}->>'controllerToken'`

function idleFor(ms: number): SQL {
  return sql`${copilotRuns.updatedAt} < now() - make_interval(secs => ${ms / 1000})`
}

const leasedRunIdle = and(isNotNull(controllerToken), idleFor(ORPHANED_RUN_GRACE_MS))
const legacyRunIdle = and(
  isNull(controllerToken),
  lt(copilotRuns.toolExecutionVersion, SIM_TOOL_EXECUTION_VERSION),
  idleFor(LEGACY_RUN_GRACE_MS)
)
const orphanIdle = or(leasedRunIdle, legacyRunIdle)

/** The user pressed Stop on this stream; a newer turn also closes tool admission, without one. */
const stopRequested = sql`(EXISTS (SELECT 1 FROM ${copilotRequestStops} s
    WHERE s.user_id = ${copilotRuns.userId} AND s.workspace_id = ${copilotRuns.workspaceId}
      AND s.stream_id = ${copilotRuns.streamId})
  OR EXISTS (SELECT 1 FROM ${copilotOrganizationRequestStops} s
    WHERE s.user_id = ${copilotRuns.userId} AND s.organization_id = ${copilotRuns.organizationId}
      AND s.stream_id = ${copilotRuns.streamId}))`

interface UnownedRun {
  id: string
  chatId: string
  streamId: string
  userId: string
  workspaceId: string | null
  organizationId: string | null
  controllerToken: string | null
}

const unownedRunColumns = {
  id: copilotRuns.id,
  chatId: copilotRuns.chatId,
  streamId: copilotRuns.streamId,
  userId: copilotRuns.userId,
  workspaceId: copilotRuns.workspaceId,
  organizationId: copilotRuns.organizationId,
  controllerToken,
}

/** A run ends cancelled only if its user pressed Stop, whoever settles it. */
function terminalValues(reason: 'orphaned' | 'legacy') {
  const error = reason === 'orphaned' ? ORPHANED_RUN_ERROR : LEGACY_RUN_ERROR
  return {
    status: sql`(CASE WHEN ${stopRequested} THEN 'cancelled' ELSE 'error' END)::copilot_run_status`,
    error: sql`CASE WHEN ${stopRequested} THEN NULL ELSE ${error}::text END`,
  }
}

/**
 * Settles each run only while it is still unfinished and still names the controller
 * the caller observed, so a finalizing controller or a successor's claim, both of
 * which write the same row, wins or loses atomically against it.
 *
 * Chat rows are locked first, in id order, as a controller's claim does, so the two
 * never wait on each other in opposite orders. A legacy run keeps its last write as its
 * completion and retention time. The chat marker is released without
 * touching the chat's ordering timestamp.
 */
async function settleRuns(
  tx: DbTransaction,
  runs: UnownedRun[],
  guard: SQL | undefined
): Promise<UnownedRun[]> {
  if (runs.length === 0) return []
  const chatIds = [...new Set(runs.map((run) => run.chatId))]
  await tx
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(inArray(copilotChats.id, chatIds))
    .orderBy(asc(copilotChats.id))
    .for('update')

  const settled: UnownedRun[] = []
  const apply = async (batch: UnownedRun[], owner: SQL, values: object) => {
    if (batch.length === 0) return
    const rows = await tx
      .update(copilotRuns)
      .set({
        ...values,
        toolAdmissionClosedAt: sql`coalesce(${copilotRuns.toolAdmissionClosedAt}, now())`,
      })
      .where(
        and(
          inArray(
            copilotRuns.id,
            batch.map((run) => run.id)
          ),
          notInArray(copilotRuns.status, TERMINAL_RUN_STATUSES),
          owner,
          guard
        )
      )
      .returning({ id: copilotRuns.id })
    const won = new Set(rows.map((row) => row.id))
    settled.push(...batch.filter((run) => won.has(run.id)))
  }

  await apply(
    runs.filter((run) => run.controllerToken === null),
    isNull(controllerToken),
    { ...terminalValues('legacy'), completedAt: sql`${copilotRuns.updatedAt}` }
  )
  for (const run of runs) {
    if (run.controllerToken === null) continue
    await apply([run], eq(controllerToken, run.controllerToken), {
      ...terminalValues('orphaned'),
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
  }

  if (settled.length > 0) {
    const markers = settled.map((run) => sql`(${run.chatId}::uuid, ${run.streamId}::text)`)
    await tx
      .update(copilotChats)
      .set({ conversationId: null })
      .where(
        sql`(${copilotChats.id}, ${copilotChats.conversationId}) IN (${sql.join(markers, sql`, `)})`
      )
  }
  return settled
}

function announceSettled(runs: UnownedRun[]): void {
  for (const run of runs) {
    try {
      publishChatStatusChanged(run, {
        chatId: run.chatId,
        type: 'completed',
        streamId: run.streamId,
      })
    } catch (error) {
      logger.warn('Settled run status could not be announced', {
        runId: run.id,
        error: getErrorMessage(error),
      })
    }
  }
}

/**
 * The streams among these whose own controller holds its chat lock, under any token: a
 * recovering controller locks the chat before it claims the run. Throws unless the
 * locks were read, since otherwise no stream is provably unowned.
 */
async function findStreamsHoldingChatLock(
  runs: Array<{ chatId: string; streamId: string }>
): Promise<Set<string>> {
  const { status, ownersByChatId } = await getChatStreamLockOwners([
    ...new Set(runs.map((run) => run.chatId)),
  ])
  if (status !== 'verified') throw new Error('Chat stream locks are unreadable')
  return new Set(
    runs.filter((run) => ownersByChatId.get(run.chatId) === run.streamId).map((run) => run.streamId)
  )
}

/** The candidates no controller owns; leased runs are skipped when ownership is unreadable. */
async function withoutOwners(candidates: UnownedRun[]): Promise<UnownedRun[]> {
  const leased = candidates.filter((run) => run.controllerToken !== null)
  const legacy = candidates.filter((run) => run.controllerToken === null)
  if (leased.length === 0) return legacy
  try {
    const [locked, replayable] = await Promise.all([
      findStreamsHoldingChatLock(leased),
      findStreamsWithReplay(leased.map((run) => run.streamId)),
    ])
    return legacy.concat(
      leased.filter((run) => !locked.has(run.streamId) && !replayable.has(run.streamId))
    )
  } catch (error) {
    logger.warn('Chat stream ownership is unreadable; leaving leased runs for a later sweep', {
      error: getErrorMessage(error),
    })
    return legacy
  }
}

/**
 * Settles runs that no controller will ever finish: a leased run whose stream holds no
 * chat lock and has no replay buffer left, idle past the recovery window, and a legacy
 * run from before the current protocol. A failed batch is logged and skipped.
 */
export async function sweepOrphanedRuns(): Promise<{ settledRunIds: string[] }> {
  const settledRunIds: string[] = []
  let cursor: string | undefined
  let considered = 0

  while (considered < SWEEP_MAX_ROWS_PER_RUN) {
    const limit = Math.min(SWEEP_BATCH_SIZE, SWEEP_MAX_ROWS_PER_RUN - considered)
    const candidates: UnownedRun[] = await db
      .select(unownedRunColumns)
      .from(copilotRuns)
      .where(
        and(
          inArray(copilotRuns.status, UNFINISHED_RUN_STATUSES),
          orphanIdle,
          cursor ? gt(copilotRuns.id, cursor) : undefined
        )
      )
      .orderBy(asc(copilotRuns.id))
      .limit(limit)
    if (candidates.length === 0) break
    considered += candidates.length
    cursor = candidates[candidates.length - 1].id

    try {
      const unowned = await withoutOwners(candidates)
      const settled = await db.transaction((tx) => settleRuns(tx, unowned, orphanIdle))
      announceSettled(settled.filter((run) => run.controllerToken !== null))
      settledRunIds.push(...settled.map((run) => run.id))
    } catch (error) {
      logger.warn('A batch of orphaned runs could not be settled; a later sweep retries it', {
        count: candidates.length,
        error: getErrorMessage(error),
      })
    }
    if (candidates.length < limit) break
    await sleep(SWEEP_BATCH_PAUSE_MS)
  }

  if (settledRunIds.length > 0) {
    logger.info('Settled runs no controller owned', { count: settledRunIds.length })
  }
  return { settledRunIds }
}

/**
 * Settles a stopped run as cancelled when no controller of its stream holds the chat
 * lock. A live controller observes the Stop and settles its own run. The update itself
 * requires the recorded Stop, so this can never settle a run nobody stopped.
 */
export async function settleStoppedRunWithoutController(runId: string): Promise<boolean> {
  const [run] = await db
    .select(unownedRunColumns)
    .from(copilotRuns)
    .where(and(eq(copilotRuns.id, runId), notInArray(copilotRuns.status, TERMINAL_RUN_STATUSES)))
    .limit(1)
  if (!run?.controllerToken) return false
  if ((await findStreamsHoldingChatLock([run])).has(run.streamId)) return false
  const settled = await db.transaction((tx) => settleRuns(tx, [run], stopRequested))
  announceSettled(settled)
  return settled.length > 0
}
