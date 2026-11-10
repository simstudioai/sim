import { db } from '@sim/db'
import { copilotChats, member, permissions, workspace } from '@sim/db/schema'
import { and, desc, eq, exists, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { MothershipChat, MothershipChatScope } from '@/lib/api/contracts/mothership-chats'
import { conversationModeSelection } from '@/lib/mothership/chat/intent'
import { reconcileChatStreamMarkers } from '@/lib/mothership/chat/stream-liveness'

/**
 * The viewer's workspace chats on workspaces they can still open (an explicit grant, or admin of
 * the workspace's organization), wherever those workspaces sit.
 */
function openableWorkspaceChat(userId: string): SQL {
  return exists(
    db
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(
          eq(workspace.id, copilotChats.workspaceId),
          isNull(workspace.archivedAt),
          or(
            exists(
              db
                .select({ id: permissions.id })
                .from(permissions)
                .where(
                  and(
                    eq(permissions.userId, userId),
                    eq(permissions.entityType, 'workspace'),
                    eq(permissions.entityId, workspace.id)
                  )
                )
            ),
            exists(
              db
                .select({ id: member.id })
                .from(member)
                .where(
                  and(
                    eq(member.userId, userId),
                    eq(member.organizationId, workspace.organizationId),
                    inArray(member.role, ['owner', 'admin'])
                  )
                )
            )
          )
        )
      )
  )
}

/**
 * Lists a user's mothership (home) chats for a workspace as the contract wire
 * shape, shared by the `GET /api/mothership/chats` route and the workspace
 * sidebar prefetch. Performs no auth or workspace-access checks — callers
 * enforce access before invoking. Reconciles stale live-stream markers and
 * normalizes timestamps to ISO strings to honor the wire contract.
 *
 * An organization's list also holds the viewer's workspace chats: a person belongs to one
 * organization, and every workspace they can open renders in it (`readWorkspaceShell`), so their
 * workspace chats, from before organization chats and on organization-less or guest workspaces
 * alike, open from it. The caller has authorized the viewer's membership of that organization.
 *
 * `scope` selects between live chats (`active`, the default) and soft-deleted
 * chats (`archived`, surfaced in Recently Deleted). Archived chats skip
 * stream-marker reconciliation — a deleted chat has no live stream to repair.
 */
export async function listMothershipChats(
  userId: string,
  owner: string | { organizationId: string },
  scope: MothershipChatScope = 'active',
  limit?: number
): Promise<MothershipChat[]> {
  const query = db
    .select({
      id: copilotChats.id,
      mode: conversationModeSelection,
      title: copilotChats.title,
      updatedAt: copilotChats.updatedAt,
      activeStreamId: copilotChats.conversationId,
      lastSeenAt: copilotChats.lastSeenAt,
      pinned: copilotChats.pinned,
      deletedAt: copilotChats.deletedAt,
    })
    .from(copilotChats)
    .where(
      and(
        eq(copilotChats.userId, userId),
        typeof owner === 'string'
          ? eq(copilotChats.workspaceId, owner)
          : or(
              eq(copilotChats.organizationId, owner.organizationId),
              openableWorkspaceChat(userId)
            ),
        eq(copilotChats.type, 'mothership'),
        sql`${copilotChats.config}->'benchmark' IS NULL`,
        scope === 'archived' ? isNotNull(copilotChats.deletedAt) : isNull(copilotChats.deletedAt)
      )
    )
    .orderBy(desc(copilotChats.pinned), desc(copilotChats.updatedAt))

  const chats =
    limit === undefined
      ? await query
      : await query.limit(z.number().int().min(1).max(200).parse(limit))

  const streamMarkers =
    scope === 'archived'
      ? null
      : await reconcileChatStreamMarkers(
          chats.map((c) => ({ chatId: c.id, streamId: c.activeStreamId })),
          { repairVerifiedStaleMarkers: true }
        )

  return chats.map((c) => ({
    id: c.id,
    mode: c.mode,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
    activeStreamId: streamMarkers?.get(c.id)?.streamId ?? null,
    lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
    pinned: c.pinned,
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
  }))
}
