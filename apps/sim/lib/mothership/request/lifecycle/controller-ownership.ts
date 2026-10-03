import { db } from '@sim/db'
import { copilotChats, copilotRuns } from '@sim/db/schema'
import { backoffWithJitter } from '@sim/utils/retry'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'

/**
 * Takeovers of one run allowed in a row before it ends as an error. A controller keeps
 * its chat lock while it streams and while it waits on parked, permission-gated or
 * client-executed tools, so only a lost controller (a pod deploy or crash, or a lost
 * lease) needs one. Five in a row is a crash loop, not a deploy.
 */
export const MAX_RECOVERY_ATTEMPTS = 5

/** A takeover this long after the previous one starts a fresh budget: that controller lived. */
export const RECOVERY_BUDGET_RESET_MS = 5 * 60_000

const RECOVERY_BACKOFF = { baseMs: 1_000, maxMs: 60_000 } as const

/** Stored on the run beside its controller token, in epoch milliseconds. */
const RecoveryBackoffSchema = z.object({
  attempts: z.number().int().positive(),
  claimedAt: z.number(),
  notBefore: z.number(),
})

export type RecoveryBackoff = z.infer<typeof RecoveryBackoffSchema>

export type RecoveryPlan =
  | { kind: 'wait' }
  | { kind: 'claim' | 'exhausted'; backoff: RecoveryBackoff }

/**
 * Exponential backoff with a restart limit for taking over a run, as a supervisor
 * restarts a crashing child. The first takeover is immediate; each later one waits
 * until the previous one's `notBefore`. Seq progress does not reset the budget: a
 * recovered leg re-persists the frames the worker replays since its last checkpoint,
 * so a crash loop advances the replay ring on every attempt.
 */
export function planRecovery(saved: unknown, now: number): RecoveryPlan {
  const previous = RecoveryBackoffSchema.safeParse(saved)
  const fresh = !previous.success || now - previous.data.claimedAt >= RECOVERY_BUDGET_RESET_MS
  if (previous.success && !fresh && now < previous.data.notBefore) return { kind: 'wait' }
  const attempts = fresh ? 1 : previous.data.attempts + 1
  const backoff = {
    attempts,
    claimedAt: now,
    notBefore: now + backoffWithJitter(attempts, null, RECOVERY_BACKOFF),
  }
  return { kind: attempts > MAX_RECOVERY_ATTEMPTS ? 'exhausted' : 'claim', backoff }
}

/**
 * Serializes takeover with assistant persistence; Redis alone cannot fence a delayed DB write.
 * Every claim replaces the controller token it compares, so the recovery budget written
 * beside it is as atomic as the claim, across pods, tabs and callers.
 */
export async function claimRunController(input: {
  runId: string
  chatId: string
  previousToken: string
  token: string
  recoveryBackoff: RecoveryBackoff
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(eq(copilotChats.id, input.chatId))
      .for('update')
    const [run] = await tx
      .update(copilotRuns)
      .set({
        requestContext: sql`${copilotRuns.requestContext} || ${JSON.stringify({
          controllerToken: input.token,
          recoveryBackoff: input.recoveryBackoff,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(copilotRuns.id, input.runId),
          eq(copilotRuns.chatId, input.chatId),
          sql`${copilotRuns.requestContext}->>'controllerToken' = ${input.previousToken}`,
          notInArray(copilotRuns.status, ['complete', 'error', 'cancelled'])
        )
      )
      .returning({ id: copilotRuns.id })
    return !!run
  })
}
