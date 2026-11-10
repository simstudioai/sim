import { db } from '@sim/db'
import { copilotChats, member, permissions, workspace } from '@sim/db/schema'
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { MothershipChat, MothershipChatScope } from '@/lib/api/contracts/mothership-chats'
import { conversationModeSelection } from '@/lib/mothership/chat/intent'
import { reconcileChatStreamMarkers } from '@/lib/mothership/chat/stream-liveness'
import { inheritsOrganizationAdmin } from '@/lib/organizations/team-only'

/**
 * The workspaces whose chats an organization's list holds for the viewer, so its live updates
 * carry those chats too and nothing else: every active workspace they can still open, with an
 * explicit grant or under an organization they administer, wherever it sits. Each branch reads
 * from the viewer's own rows through an index.
 */
export async function listOpenableChatWorkspaceIds(userId: string): Promise<Set<string>> {
  const [granted, administered] = await Promise.all([
    db
      .select({ id: workspace.id })
      .from(permissions)
      .innerJoin(workspace, eq(workspace.id, permissions.entityId))
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          isNull(workspace.archivedAt)
        )
      ),
    db
      .select({ id: workspace.id })
      .from(member)
      .innerJoin(workspace, eq(workspace.organizationId, member.organizationId))
      .where(
        and(eq(member.userId, userId), inheritsOrganizationAdmin(), isNull(workspace.archivedAt))
      ),
  ])
  return new Set([...granted, ...administered].map((row) => row.id))
}

/**
 * The organization's chats beside the viewer's chats on workspaces they can still open, as two
 * plain predicates so each branch can use its `(user_id, …)` index.
 */
async function organizationListCondition(userId: string, organizationId: string): Promise<SQL> {
  const workspaceIds = await listOpenableChatWorkspaceIds(userId)
  const organizationChat = eq(copilotChats.organizationId, organizationId)
  if (workspaceIds.size === 0) return organizationChat
  return (
    or(organizationChat, inArray(copilotChats.workspaceId, [...workspaceIds])) ?? organizationChat
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
  const ownerCondition =
    typeof owner === 'string'
      ? eq(copilotChats.workspaceId, owner)
      : await organizationListCondition(userId, owner.organizationId)
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
        ownerCondition,
        eq(copilotChats.type, 'mothership'),
        sql`${copilotChats.config}->'benchmark' IS NULL`,
        scope === 'archived' ? isNotNull(copilotChats.deletedAt) : isNull(copilotChats.deletedAt)
      )
    )
    .orderBy(desc(copilotChats.pinned), desc(copilotChats.updatedAt), desc(copilotChats.id))

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
