import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { MothershipChat } from '@/lib/api/contracts/mothership-chats'
import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'

/**
 * Lists a user's mothership (home) chats for a workspace as the contract wire
 * shape, shared by the `GET /api/mothership/chats` route and the workspace
 * sidebar prefetch. Performs no auth or workspace-access checks — callers
 * enforce access before invoking. Reconciles stale live-stream markers and
 * normalizes timestamps to ISO strings to honor the wire contract.
 */
export async function listMothershipChats(
  userId: string,
  workspaceId: string
): Promise<MothershipChat[]> {
  const chats = await db
    .select({
      id: copilotChats.id,
      title: copilotChats.title,
      updatedAt: copilotChats.updatedAt,
      activeStreamId: copilotChats.conversationId,
      lastSeenAt: copilotChats.lastSeenAt,
      pinned: copilotChats.pinned,
    })
    .from(copilotChats)
    .where(
      and(
        eq(copilotChats.userId, userId),
        eq(copilotChats.workspaceId, workspaceId),
        eq(copilotChats.type, 'mothership')
      )
    )
    .orderBy(desc(copilotChats.pinned), desc(copilotChats.updatedAt))

  const streamMarkers = await reconcileChatStreamMarkers(
    chats.map((c) => ({ chatId: c.id, streamId: c.activeStreamId })),
    { repairVerifiedStaleMarkers: true }
  )

  return chats.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
    activeStreamId: streamMarkers.get(c.id)?.streamId ?? null,
    lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
    pinned: c.pinned,
  }))
}
