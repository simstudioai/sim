import { db } from '@sim/db'
import { copilotMessages } from '@sim/db/schema'
import { toRecord } from '@sim/utils/object'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { SteerV2Request } from '@/lib/mothership/generated/protocol'
import type { PreparedSteeringInput } from '@/lib/mothership/request/application/steering-input'
import { requestStreamSteering } from '@/lib/mothership/request/session/steer'

/**
 * A steering message as Sim recorded it before asking the worker: the run it was
 * sent into, its text, and the exact input the worker was sent, so every later
 * read of its disposition re-sends identical bytes (the worker refuses a retry
 * whose input differs).
 */
export interface SteeringRecord {
  streamId: string
  content: string
  input: Pick<PreparedSteeringInput, 'context' | 'assistantImages'>
}

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

/** The steering record a chat holds under `messageId`, if that id was sent as steering. */
export async function loadSteeringRecord(
  chatId: string,
  messageId: string
): Promise<SteeringRecord | undefined> {
  const [row] = await db
    .select({ content: copilotMessages.content })
    .from(copilotMessages)
    .where(steeringRow(chatId, messageId))
    .limit(1)
  if (!row) return undefined
  const message = toRecord(row.content)
  const steering = toRecord(message.steering)
  if (typeof steering.streamId !== 'string' || typeof message.content !== 'string') return undefined
  const input = toRecord(steering.input)
  return {
    streamId: steering.streamId,
    content: message.content,
    input: {
      context: Array.isArray(input.context)
        ? (input.context as PreparedSteeringInput['context'])
        : [],
      ...(Array.isArray(input.assistantImages)
        ? { assistantImages: input.assistantImages as SteerV2Request['assistantImages'] }
        : {}),
    },
  }
}

/**
 * Settles a turn sent under the id of a steering message the user sent into an
 * earlier turn, before it is admitted. The worker's durable disposition of that
 * id decides, read with the recorded input. A message no run applied (or one the
 * worker refused) loses its steering record, so the turn's own message is stored
 * after the turn it failed to steer rather than at the place the record holds.
 */
export async function resolveSteeringFallback(params: {
  chatId: string
  messageId: string
  userId: string
}): Promise<SteeringFallback> {
  const { chatId, messageId, userId } = params
  const record = await loadSteeringRecord(chatId, messageId)
  if (!record) return { kind: 'send' }
  const disposition = await requestStreamSteering({
    streamId: record.streamId,
    userId,
    chatId,
    steeringId: messageId,
    content: record.content,
    ...record.input,
  })
  if (disposition.status === 'applied') return { kind: 'applied' }
  if (disposition.status === 'queued') return { kind: 'busy', streamId: record.streamId }
  await db.delete(copilotMessages).where(steeringRow(chatId, messageId))
  return { kind: 'send' }
}
