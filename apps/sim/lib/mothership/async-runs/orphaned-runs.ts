import { db } from '@sim/db'
import {
  type CopilotRunStatus,
  copilotAsyncToolCalls,
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
  lte,
  not,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import type { DbTransaction } from '@/lib/db/types'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import {
  acquirePendingChatStream,
  getChatStreamLockOwners,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { findStreamsWithReplay } from '@/lib/mothership/request/session/buffer'
import type { ChatStreamLease } from '@/lib/mothership/request/session/controller-lease'

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
 * deadline. Liveness comes only from heartbeats, which run for as long as their work
 * does, however long that is: a run whose stream holds the chat lock, which its live
 * controller renews, or whose Sim tool holds an execution lease, is never settled. For a
 * run with neither, this window and the replay buffer's `:seq` key (whose TTL each write
 * renews, `COPILOT_STREAM_TTL_SECONDS`, one hour by default) leave a reconnect time to
 * resume it; the sweep waits for both.
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
/** Settles at most about this many runs per sweep, to bound its synchronous commits. */
const SWEEP_MAX_SETTLED_PER_RUN = 5_000
/** Examines at most this many candidates per sweep; the next sweep resumes after them. */
const SWEEP_MAX_EXAMINED_PER_RUN = 10_000
/**
 * Where the last sweep stopped, so runs that cannot be settled yet (their chat is locked
 * or their replay is live) never starve the runs after them. It wraps to the start.
 */
const SWEEP_CURSOR_KEY = 'copilot:orphaned-runs:sweep-cursor'
const SWEEP_CURSOR_TTL_SECONDS = 7 * 24 * 60 * 60
/** Spaces full batches so a backlog drains without a sustained burst of synchronous commits. */
const SWEEP_BATCH_PAUSE_MS = 200

const controllerToken = sql<string | null>`${copilotRuns.requestContext}->>'controllerToken'`

function idleFor(ms: number): SQL {
  return sql`${copilotRuns.updatedAt} < now() - make_interval(secs => ${ms / 1000})`
}

/**
 * One of the run's Sim tools is still executing. A tool call writes nothing to its run
 * while it runs, however long that is; its owner only renews this execution lease by
 * heartbeat, so an unexpired lease is live Sim work the worker is still waiting on.
 */
const toolExecuting = sql`EXISTS (SELECT 1 FROM ${copilotAsyncToolCalls} t
    WHERE t.run_id = ${copilotRuns.id} AND t.execution_settled_at IS NULL
      AND t.execution_revoked_at IS NULL AND t.execution_lease_expires_at > clock_timestamp())`

const leasedRunIdle = and(
  isNotNull(controllerToken),
  idleFor(ORPHANED_RUN_GRACE_MS),
  not(toolExecuting)
)
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
 * never wait on each other in opposite orders. The run rows are locked next, before the
 * guarded update takes its snapshot: a tool's admission locks its run row, so the update
 * then sees any execution lease an admission committed, and a later admission sees the
 * run settled. Their unsettled tool executions are locked last: a lease heartbeat
 * writes only the tool row, so one already past its expiry check commits before the
 * update reads the lease, and a later one finds the lease expired. A legacy run keeps
 * its last write as its completion and retention time. The chat marker is released
 * without touching the chat's ordering timestamp.
 */
async function settleRuns(
  tx: DbTransaction,
  runs: UnownedRun[],
  guard: SQL | undefined
): Promise<{ settled: UnownedRun[]; released: UnownedRun[] }> {
  if (runs.length === 0) return { settled: [], released: [] }
  const chatIds = [...new Set(runs.map((run) => run.chatId))]
  await tx
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(inArray(copilotChats.id, chatIds))
    .orderBy(asc(copilotChats.id))
    .for('update')
  const runIds = runs.map((run) => run.id)
  await tx
    .select({ id: copilotRuns.id })
    .from(copilotRuns)
    .where(inArray(copilotRuns.id, runIds))
    .orderBy(asc(copilotRuns.id))
    .for('update')
  await tx
    .select({ id: copilotAsyncToolCalls.id })
    .from(copilotAsyncToolCalls)
    .where(
      and(
        inArray(copilotAsyncToolCalls.runId, runIds),
        isNotNull(copilotAsyncToolCalls.executionOwnerToken),
        isNull(copilotAsyncToolCalls.executionSettledAt),
        isNull(copilotAsyncToolCalls.executionRevokedAt)
      )
    )
    .orderBy(asc(copilotAsyncToolCalls.id))
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

  if (settled.length === 0) return { settled, released: [] }
  const markers = settled.map((run) => sql`(${run.chatId}::uuid, ${run.streamId}::text)`)
  const cleared = await tx
    .update(copilotChats)
    .set({ conversationId: null })
    .where(
      sql`(${copilotChats.id}, ${copilotChats.conversationId}) IN (${sql.join(markers, sql`, `)})`
    )
    .returning({ id: copilotChats.id })
  const releasedChats = new Set(cleared.map((chat) => chat.id))
  return { settled, released: settled.filter((run) => releasedChats.has(run.chatId)) }
}

/** Tells open clients a chat is no longer busy, for every chat whose marker was released. */
function announceReleased(runs: UnownedRun[]): void {
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

interface ChatLockFence {
  run: UnownedRun
  lease: ChatStreamLease
}

/**
 * Takes each unowned leased run's chat lock under the run's own stream, as a reconnect
 * would, so no controller can take over between the ownership check and the settle.
 * A reconnect that meets the fence retries; runs whose lock is taken are skipped.
 */
async function fenceChatLocks(runs: UnownedRun[]): Promise<ChatLockFence[]> {
  const fenced = await Promise.all(
    runs.map(async (run) => {
      if (!(await acquirePendingChatStream(run.chatId, run.streamId, 0))) return null
      const lease = getLocalChatStreamLease(run.chatId, run.streamId)
      return lease ? { run, lease } : null
    })
  )
  return fenced.filter((fence): fence is ChatLockFence => fence !== null)
}

async function releaseChatLocks(fences: ChatLockFence[]): Promise<void> {
  await Promise.all(
    fences.map(({ run, lease }) => releasePendingChatStream(run.chatId, run.streamId, lease))
  )
}

async function readSweepCursor(): Promise<string | undefined> {
  try {
    return (await getRedisClient()?.get(SWEEP_CURSOR_KEY)) ?? undefined
  } catch (error) {
    logger.warn('Orphaned-run sweep cursor is unreadable; starting from the first run', {
      error: getErrorMessage(error),
    })
    return undefined
  }
}

async function writeSweepCursor(cursor: string | undefined): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    if (cursor) await redis.set(SWEEP_CURSOR_KEY, cursor, 'EX', SWEEP_CURSOR_TTL_SECONDS)
    else await redis.del(SWEEP_CURSOR_KEY)
  } catch (error) {
    logger.warn('Orphaned-run sweep cursor could not be saved', { error: getErrorMessage(error) })
  }
}

/** Settles one examined batch, fencing leased runs on their chat locks while it commits. */
async function settleBatch(candidates: UnownedRun[]): Promise<UnownedRun[]> {
  const unowned = await withoutOwners(candidates)
  const fences = await fenceChatLocks(unowned.filter((run) => run.controllerToken !== null))
  try {
    const eligible = unowned
      .filter((run) => run.controllerToken === null)
      .concat(fences.map(({ run }) => run))
    const { settled, released } = await db.transaction((tx) => settleRuns(tx, eligible, orphanIdle))
    announceReleased(released)
    return settled
  } finally {
    await releaseChatLocks(fences)
  }
}

/**
 * Settles runs that no controller will ever finish: a leased run whose stream holds no
 * chat lock and has no replay buffer left, with no Sim tool still executing, idle past
 * the recovery window, and a legacy run from before the current protocol. Each sweep
 * resumes where the last one stopped and wraps to the first run, so no run is starved by
 * the ones before it. A failed batch is logged and skipped.
 */
export async function sweepOrphanedRuns(): Promise<{ settledRunIds: string[] }> {
  const settledRunIds: string[] = []
  const start = await readSweepCursor()
  let cursor = start
  let wrapped = start === undefined
  let examined = 0

  while (
    examined < SWEEP_MAX_EXAMINED_PER_RUN &&
    settledRunIds.length < SWEEP_MAX_SETTLED_PER_RUN
  ) {
    const limit = Math.min(SWEEP_BATCH_SIZE, SWEEP_MAX_EXAMINED_PER_RUN - examined)
    const candidates: UnownedRun[] = await db
      .select(unownedRunColumns)
      .from(copilotRuns)
      .where(
        and(
          inArray(copilotRuns.status, UNFINISHED_RUN_STATUSES),
          orphanIdle,
          cursor ? gt(copilotRuns.id, cursor) : undefined,
          wrapped && start ? lte(copilotRuns.id, start) : undefined
        )
      )
      .orderBy(asc(copilotRuns.id))
      .limit(limit)
    examined += candidates.length
    if (candidates.length > 0) {
      cursor = candidates[candidates.length - 1].id
      try {
        settledRunIds.push(...(await settleBatch(candidates)).map((run) => run.id))
      } catch (error) {
        logger.warn('A batch of orphaned runs could not be settled; a later sweep retries it', {
          count: candidates.length,
          error: getErrorMessage(error),
        })
      }
    }
    if (candidates.length < limit) {
      /** The end of the table: wrap once to cover the runs before the starting point. */
      cursor = undefined
      if (wrapped) break
      wrapped = true
      continue
    }
    await sleep(SWEEP_BATCH_PAUSE_MS)
  }

  await writeSweepCursor(cursor)
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
  const { settled, released } = await db.transaction((tx) => settleRuns(tx, [run], stopRequested))
  announceReleased(released)
  return settled.length > 0
}
