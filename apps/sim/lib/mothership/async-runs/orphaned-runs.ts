import { db } from '@sim/db'
import { type CopilotRunStatus, copilotChats, copilotRuns } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/mothership/constants'
import { findStreamsWithReplay } from '@/lib/mothership/request/session/buffer'
import { findStreamsHoldingChatLock } from '@/lib/mothership/request/session/controller-lease'

const logger = createLogger('OrphanedCopilotRuns')

const TERMINAL_RUN_STATUSES: CopilotRunStatus[] = ['complete', 'error', 'cancelled']
/** Listed positively so the sweep's scan stays on the status index once few runs are open. */
const UNFINISHED_RUN_STATUSES: CopilotRunStatus[] = [
  'active',
  'paused_waiting_for_tool',
  'resuming',
]

/**
 * How long a leased run must sit without a controller or a durable write before it is
 * settled. No worker leg outlives the orchestration budget, so past it a reconnect has
 * nothing left to resume.
 */
export const ORPHANED_RUN_GRACE_MS = ORCHESTRATION_TIMEOUT_MS

/**
 * Runs admitted without a chat lease (headless turns and rows from before the lease
 * protocol) have no liveness signal, so only an age far past any process lifetime
 * proves them dead.
 */
export const UNLEASED_RUN_GRACE_MS = 24 * 60 * 60 * 1000

export const ORPHANED_RUN_ERROR = 'This response was interrupted before it finished.'

const SWEEP_BATCH_SIZE = 500
const SWEEP_MAX_ROWS_PER_RUN = 10_000

const controllerToken = sql<string | null>`${copilotRuns.requestContext}->>'controllerToken'`

function idleFor(ms: number): SQL {
  return sql`${copilotRuns.updatedAt} < now() - make_interval(secs => ${ms / 1000})`
}

const leasedRunIdle = and(isNotNull(controllerToken), idleFor(ORPHANED_RUN_GRACE_MS))
const unleasedRunIdle = and(isNull(controllerToken), idleFor(UNLEASED_RUN_GRACE_MS))

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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Settles each run only while it is still unfinished and still names the controller
 * the caller observed, so a finalizing controller or a successor's claim, both of
 * which write the same row, wins or loses atomically against it. A run that Stop
 * already closed settles as cancelled. The chat marker is released without touching
 * the chat's ordering timestamp.
 */
async function settleRuns(
  tx: Transaction,
  runs: UnownedRun[],
  guard: SQL | undefined,
  outcome: { status: 'error' | 'cancelled'; error?: string }
): Promise<UnownedRun[]> {
  const settled: UnownedRun[] = []
  const apply = async (owner: SQL | undefined, batch: UnownedRun[]) => {
    if (batch.length === 0) return
    const rows = await tx
      .update(copilotRuns)
      .set({
        status: sql`(CASE WHEN ${copilotRuns.toolAdmissionClosedAt} IS NOT NULL THEN 'cancelled' ELSE ${outcome.status} END)::copilot_run_status`,
        error: sql`CASE WHEN ${copilotRuns.toolAdmissionClosedAt} IS NOT NULL THEN NULL ELSE ${outcome.error ?? null}::text END`,
        completedAt: sql`now()`,
        toolAdmissionClosedAt: sql`coalesce(${copilotRuns.toolAdmissionClosedAt}, now())`,
        updatedAt: sql`now()`,
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
    isNull(controllerToken),
    runs.filter((run) => run.controllerToken === null)
  )
  for (const run of runs) {
    if (run.controllerToken !== null) await apply(eq(controllerToken, run.controllerToken), [run])
  }

  for (const run of settled) {
    await tx
      .update(copilotChats)
      .set({ conversationId: null })
      .where(and(eq(copilotChats.id, run.chatId), eq(copilotChats.conversationId, run.streamId)))
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
 * Settles runs that no controller will ever finish: a leased run whose stream holds no
 * chat lock and has no replay buffer left, idle past the recovery window, and a run
 * without a lease idle past any process lifetime. Unreadable locks skip leased runs.
 */
export async function sweepOrphanedRuns(): Promise<{ settledRunIds: string[] }> {
  const settledRunIds: string[] = []
  const idle = or(leasedRunIdle, unleasedRunIdle)
  let cursor: string | undefined
  let considered = 0

  while (considered < SWEEP_MAX_ROWS_PER_RUN) {
    const candidates: UnownedRun[] = await db
      .select(unownedRunColumns)
      .from(copilotRuns)
      .where(
        and(
          inArray(copilotRuns.status, UNFINISHED_RUN_STATUSES),
          idle,
          cursor ? gt(copilotRuns.id, cursor) : undefined
        )
      )
      .orderBy(asc(copilotRuns.id))
      .limit(Math.min(SWEEP_BATCH_SIZE, SWEEP_MAX_ROWS_PER_RUN - considered))
    if (candidates.length === 0) break
    considered += candidates.length
    cursor = candidates[candidates.length - 1].id

    const leased = candidates.filter((run) => run.controllerToken !== null)
    let unowned = candidates.filter((run) => run.controllerToken === null)
    if (leased.length > 0) {
      try {
        const [locked, replayable] = await Promise.all([
          findStreamsHoldingChatLock(leased),
          findStreamsWithReplay(leased.map((run) => run.streamId)),
        ])
        unowned = unowned.concat(
          leased.filter((run) => !locked.has(run.streamId) && !replayable.has(run.streamId))
        )
      } catch (error) {
        logger.warn('Chat stream ownership is unreadable; leaving leased runs for a later sweep', {
          error: getErrorMessage(error),
        })
      }
    }

    const settled = await db.transaction((tx) =>
      settleRuns(tx, unowned, idle, { status: 'error', error: ORPHANED_RUN_ERROR })
    )
    announceSettled(settled.filter((run) => run.controllerToken !== null))
    settledRunIds.push(...settled.map((run) => run.id))
  }

  if (settledRunIds.length > 0) {
    logger.info('Settled runs no controller owned', { count: settledRunIds.length })
  }
  return { settledRunIds }
}

/**
 * Settles a stopped run as cancelled when no controller of its stream holds the chat
 * lock. A live controller observes the Stop and settles its own run.
 */
export async function settleStoppedRunWithoutController(runId: string): Promise<boolean> {
  const [run] = await db
    .select(unownedRunColumns)
    .from(copilotRuns)
    .where(and(eq(copilotRuns.id, runId), notInArray(copilotRuns.status, TERMINAL_RUN_STATUSES)))
    .limit(1)
  if (!run?.controllerToken) return false
  if ((await findStreamsHoldingChatLock([run])).has(run.streamId)) return false
  const settled = await db.transaction((tx) =>
    settleRuns(tx, [run], undefined, { status: 'cancelled' })
  )
  announceSettled(settled)
  return settled.length > 0
}
