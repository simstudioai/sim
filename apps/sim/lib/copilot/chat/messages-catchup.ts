import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'

const logger = createLogger('CopilotChatMessagesCatchup')

/**
 * Sweep recently-active chats from `copilot_chats.messages` JSONB into the new
 * `copilot_chat_messages` table. Idempotent via `ON CONFLICT DO NOTHING`.
 *
 * Bounded to the last 7 days of activity so the cost is bounded regardless of
 * total table size. The migration handles initial backfill; this sweep only
 * exists to close the rolling-deploy window where old code may write to JSONB
 * before the new dual-write code is live on every server.
 */
export async function catchUpCopilotChatMessages(): Promise<void> {
  try {
    const result = await db.execute(sql`
      INSERT INTO copilot_chat_messages (chat_id, message_id, role, content, model, created_at, updated_at)
      SELECT
        c.id,
        COALESCE(msg.value->>'id', gen_random_uuid()::text),
        COALESCE(msg.value->>'role', 'user'),
        msg.value,
        COALESCE(msg.value->>'model', c.model),
        COALESCE(
          NULLIF(msg.value->>'createdAt','')::timestamp,
          c.created_at + (msg.ord * interval '1 microsecond')
        ),
        COALESCE(
          NULLIF(msg.value->>'createdAt','')::timestamp,
          c.created_at + (msg.ord * interval '1 microsecond')
        )
      FROM copilot_chats c
      CROSS JOIN LATERAL jsonb_array_elements(c.messages) WITH ORDINALITY AS msg(value, ord)
      WHERE c.updated_at > now() - interval '7 days'
        AND jsonb_typeof(c.messages) = 'array'
        AND jsonb_array_length(c.messages) > 0
      ON CONFLICT (chat_id, message_id) DO NOTHING
    `)
    logger.info('Copilot chat messages catch-up completed', {
      rowCount: (result as { rowCount?: number }).rowCount ?? 0,
    })
  } catch (err) {
    logger.warn('Copilot chat messages catch-up failed', { error: getErrorMessage(err) })
  }
}
