import { copilotMessages } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { classifyTimestampCursor } from '@/lib/api/list-query'

/**
 * A message's position in canonical transcript order (`seq ASC NULLS LAST, created_at, id`).
 * `createdAt` is the column's `preciseTimestampText`, so the keyset compares at full
 * microsecond precision.
 */
export interface TranscriptPosition {
  seq: number | null
  createdAt: string
  id: string
}

const transcriptPositionSchema = z.object({
  seq: z.number().int().min(-2147483648).max(2147483647).nullable(),
  createdAt: z.string().refine((value) => classifyTimestampCursor(value) === 'precise'),
  id: z.string().uuid(),
})

/** A base64url cursor for `position`; `createdAt` keeps the column's microsecond precision. */
export function encodeTranscriptCursor(position: TranscriptPosition): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url')
}

/** Null for a cursor this server did not issue. */
export function decodeTranscriptCursor(cursor: string): TranscriptPosition | null {
  try {
    const parsed = transcriptPositionSchema.safeParse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString())
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function createdAtAndIdBefore(position: TranscriptPosition): SQL {
  return sql`(${copilotMessages.createdAt}, ${copilotMessages.id}) < (${position.createdAt}::timestamp, ${position.id}::uuid)`
}

/**
 * Messages strictly before `position`. A null `seq` sorts after every sequenced message. The
 * redundant `seq <=` bound lets a backward index scan start at the cursor instead of the
 * newest message.
 */
export function transcriptBefore(position: TranscriptPosition): SQL {
  if (position.seq === null) {
    return sql`(${copilotMessages.seq} IS NOT NULL OR ${createdAtAndIdBefore(position)})`
  }
  return sql`(${copilotMessages.seq} <= ${position.seq} AND (${copilotMessages.seq} < ${position.seq} OR ${createdAtAndIdBefore(position)}))`
}

/** Messages at or after `position`: the complement of {@link transcriptBefore}. */
export function transcriptAtOrAfter(position: TranscriptPosition): SQL {
  if (position.seq === null) {
    return sql`(${copilotMessages.seq} IS NULL AND NOT ${createdAtAndIdBefore(position)})`
  }
  return sql`(${copilotMessages.seq} IS NULL OR ${copilotMessages.seq} > ${position.seq} OR (${copilotMessages.seq} = ${position.seq} AND NOT ${createdAtAndIdBefore(position)}))`
}
