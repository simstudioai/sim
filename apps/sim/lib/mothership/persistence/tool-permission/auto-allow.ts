import { db } from '@sim/db'
import { copilotChats, settings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'

const logger = createLogger('CopilotToolAutoAllow')

function toToolNameSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((entry): entry is string => typeof entry === 'string'))
}

/**
 * The tool ids this request may run unprompted: the user's account-wide
 * always-allow list, plus anything allowed for the rest of this chat.
 *
 * Read once per chat request and carried on the streaming context, so a turn
 * that calls twenty gated tools does not issue twenty settings lookups.
 */
export async function getAutoAllowedTools(
  userId: string | null | undefined,
  chatId?: string | null
): Promise<Set<string>> {
  if (!userId) return new Set()
  try {
    const [userRow, chatRow] = await Promise.all([
      db
        .select({ tools: settings.copilotAutoAllowedTools })
        .from(settings)
        .where(eq(settings.userId, userId))
        .limit(1)
        .then((rows) => rows[0]),
      chatId
        ? db
            .select({ tools: copilotChats.autoAllowedTools })
            .from(copilotChats)
            .where(eq(copilotChats.id, chatId))
            .limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
    ])
    return new Set([...toToolNameSet(userRow?.tools), ...toToolNameSet(chatRow?.tools)])
  } catch (error) {
    // Fail closed: an unreadable preference list means we prompt, never that we
    // silently run a gated tool.
    logger.warn('Failed to read auto-allowed tools; treating as empty', {
      userId,
      chatId,
      error: toError(error).message,
    })
    return new Set()
  }
}

/**
 * Adds a tool to the user's account-wide always-allow list.
 *
 * Written as a single containment-guarded append so two prompts answered with
 * "always allow" at the same moment cannot clobber each other the way a
 * read-modify-write would.
 */
export async function addAutoAllowedTool(userId: string, toolName: string): Promise<void> {
  const entry = JSON.stringify([toolName])
  await db
    .insert(settings)
    .values({
      id: generateShortId(),
      userId,
      copilotAutoAllowedTools: [toolName],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        copilotAutoAllowedTools: sql`CASE WHEN ${settings.copilotAutoAllowedTools} @> ${entry}::jsonb THEN ${settings.copilotAutoAllowedTools} ELSE ${settings.copilotAutoAllowedTools} || ${entry}::jsonb END`,
        updatedAt: new Date(),
      },
    })
}

/** Adds a tool to one chat's allow list, leaving the user's other chats alone. */
export async function addChatAutoAllowedTool(chatId: string, toolName: string): Promise<void> {
  const entry = JSON.stringify([toolName])
  await db
    .update(copilotChats)
    .set({
      autoAllowedTools: sql`CASE WHEN ${copilotChats.autoAllowedTools} @> ${entry}::jsonb THEN ${copilotChats.autoAllowedTools} ELSE ${copilotChats.autoAllowedTools} || ${entry}::jsonb END`,
      updatedAt: new Date(),
    })
    .where(eq(copilotChats.id, chatId))
}
