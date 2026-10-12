import { copilotChats } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'
import type { MothershipEffort } from '@/lib/mothership/model-options'

export type ConversationMode = 'agent' | 'assistant' | 'plan'

/** Historical organization chats were search-only; admission stores the latest authorized turn mode. */
export const conversationModeSelection = sql<ConversationMode>`CASE
  WHEN ${copilotChats.config}->>'conversationMode' = 'plan' THEN 'plan'
  WHEN ${copilotChats.organizationId} IS NULL THEN 'agent'
  WHEN ${copilotChats.config}->>'conversationMode' = 'agent' THEN 'agent'
  ELSE 'assistant' END`

const MOTHERSHIP_EFFORTS = ChatPayloadSchema.shape.effort.unwrap().options

/**
 * The effort the user explicitly picked for this chat, or null while it follows the default.
 * A stored value outside the protocol's effort range reads as no choice.
 */
export const chatEffortSelection = sql<MothershipEffort | null>`CASE
  WHEN ${copilotChats.config}->>'effort' IN (${sql.join(
    MOTHERSHIP_EFFORTS.map((effort) => sql`${effort}`),
    sql`, `
  )}) THEN ${copilotChats.config}->>'effort' END`

/** Merges an explicit effort choice into a chat config expression, keeping its other keys. */
export function withChatEffortChoice(config: SQL, effort: MothershipEffort): SQL {
  return sql`${config} || jsonb_build_object('effort', ${effort}::text)`
}
