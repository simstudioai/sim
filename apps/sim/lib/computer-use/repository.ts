import { db } from '@sim/db'
import { copilotAsyncToolCalls, copilotChats, copilotRuns } from '@sim/db/schema'
import { ComputerUseSchema } from '@sim/desktop-bridge/computer-use'
import { omit, toRecord } from '@sim/utils/object'
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'

interface ComputerUseClaim {
  toolCallId: string
  runId: string
  chatId: string
  userId: string
}

/** Locks the run with its action so Stop and native admission have a single ordering point. */
export async function claimComputerUseTool(input: ComputerUseClaim) {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ args: copilotAsyncToolCalls.args })
      .from(copilotRuns)
      .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
      .innerJoin(copilotAsyncToolCalls, eq(copilotAsyncToolCalls.runId, copilotRuns.id))
      .where(
        and(
          eq(copilotRuns.id, input.runId),
          eq(copilotRuns.chatId, input.chatId),
          eq(copilotRuns.userId, input.userId),
          notInArray(copilotRuns.status, ['complete', 'error', 'cancelled']),
          isNull(copilotRuns.toolAdmissionClosedAt),
          eq(copilotChats.userId, input.userId),
          isNull(copilotChats.deletedAt),
          eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
          eq(copilotAsyncToolCalls.toolName, 'computer'),
          eq(copilotAsyncToolCalls.status, 'pending'),
          isNull(copilotAsyncToolCalls.claimedBy),
          sql`${copilotAsyncToolCalls.createdAt} > now() - interval '2 minutes'`
        )
      )
      .for('update', { of: copilotRuns })
      .limit(1)
    if (
      !pending ||
      !ComputerUseSchema.safeParse(omit(toRecord(pending.args), ['activity'])).success
    )
      return null
    const now = new Date()
    const [claimed] = await tx
      .update(copilotAsyncToolCalls)
      .set({
        status: 'running',
        claimedBy: DESKTOP_TOOL_CLAIM_OWNER.computer,
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
          eq(copilotAsyncToolCalls.status, 'pending')
        )
      )
      .returning({ args: copilotAsyncToolCalls.args })
    return claimed
      ? { args: ComputerUseSchema.parse(omit(toRecord(claimed.args), ['activity'])) }
      : null
  })
}
