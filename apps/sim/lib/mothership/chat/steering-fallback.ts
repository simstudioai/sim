import { db } from '@sim/db'
import { copilotMessages } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { requestStreamSteering } from '@/lib/mothership/request/session/steer'

/**
 * What a turn whose message id is a steering id may do:
 * - `send`: no run applied the message, so it goes out as this turn;
 * - `applied`: a run already applied it, so it is in the conversation already;
 * - `busy`: the run it steered (`streamId`) still holds it and may yet apply it.
 */
type SteeringFallback = { kind: 'send' } | { kind: 'applied' } | { kind: 'busy'; streamId: string }

const steeringRow = (chatId: string, messageId: string) =>
  and(
    eq(copilotMessages.chatId, chatId),
    eq(copilotMessages.messageId, messageId),
    isNull(copilotMessages.deletedAt),
    sql`${copilotMessages.content} ? 'steering'`
  )

/**
 * Settles a turn sent under the id of a steering message the user sent into an
 * earlier turn, before it is admitted. The worker's disposition of that id
 * decides: v2 answers from its durable record, and a v1 worker refuses once the
 * run closed, which reads as not applied. A message no run applied loses its
 * steering record, so the turn's own message is stored after the turn it failed
 * to steer rather than at the place the record holds.
 */
export async function resolveSteeringFallback(params: {
  chatId: string
  messageId: string
  userId: string
  content: string
}): Promise<SteeringFallback> {
  const { chatId, messageId, userId, content } = params
  const [record] = await db
    .select({
      streamId: sql<string | null>`${copilotMessages.content} -> 'steering' ->> 'streamId'`,
    })
    .from(copilotMessages)
    .where(steeringRow(chatId, messageId))
    .limit(1)
  if (!record?.streamId) return { kind: 'send' }
  const disposition = await requestStreamSteering({
    streamId: record.streamId,
    userId,
    chatId,
    steeringId: messageId,
    content,
  })
  if (disposition.status === 'applied') return { kind: 'applied' }
  if (disposition.status === 'queued') return { kind: 'busy', streamId: record.streamId }
  await db.delete(copilotMessages).where(steeringRow(chatId, messageId))
  return { kind: 'send' }
}
