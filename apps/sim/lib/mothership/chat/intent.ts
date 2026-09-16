import { copilotChats } from '@sim/db/schema'
import { sql } from 'drizzle-orm'

export type ConversationMode = 'agent' | 'assistant'

/** Historical organization chats were search-only; admission stores the latest authorized turn mode. */
export const conversationModeSelection = sql<ConversationMode>`CASE
  WHEN ${copilotChats.organizationId} IS NULL THEN 'agent'
  WHEN ${copilotChats.config}->>'conversationMode' = 'agent' THEN 'agent'
  ELSE 'assistant' END`
