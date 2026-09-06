import { db } from '@sim/db'
import { copilotChats, copilotRuns } from '@sim/db/schema'
import { and, eq, notInArray, sql } from 'drizzle-orm'

/** Serializes takeover with assistant persistence; Redis alone cannot fence a delayed DB write. */
export async function claimRunController(input: {
  runId: string
  chatId: string
  previousToken: string
  token: string
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
        requestContext: sql`jsonb_set(${copilotRuns.requestContext}, '{controllerToken}', ${JSON.stringify(input.token)}::jsonb)`,
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
