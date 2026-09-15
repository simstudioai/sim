import { copilotChats } from '@sim/db/schema'
import { sql } from 'drizzle-orm'

export type ConversationMode = 'agent' | 'assistant'

/** Historical organization chats were search-only; new intent is immutable server-owned config. */
export const conversationModeSelection = sql<ConversationMode>`CASE
  WHEN ${copilotChats.organizationId} IS NULL THEN 'agent'
  WHEN ${copilotChats.config}->>'conversationMode' = 'agent' THEN 'agent'
  ELSE 'assistant' END`
