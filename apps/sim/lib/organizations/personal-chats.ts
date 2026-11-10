import {
  copilotChats,
  copilotMessages,
  copilotOrganizationRequestStops,
  copilotRequestStops,
  copilotRuns,
  member,
  organization,
  uploadSession,
  user,
  workspace,
} from '@sim/db/schema'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { stopLiveRunsTx } from '@/lib/mothership/async-runs/repository'
import { enqueueChatRescopeTx } from '@/lib/mothership/chat/rescope-event'
import { createDefaultPersonalWorkspaceInTransaction } from '@/lib/workspaces/create'

export interface RehomedPersonalChats {
  /** The owner's personal workspace that now holds the chats; null when there was nothing to move. */
  workspaceId: string | null
  chatCount: number
  /** Private attachments those chats name, now held by the workspace. */
  attachmentCount: number
  /** The queued outbox events that move the worker's copy of the chats. */
  rescopeEventIds: string[]
}

async function oldestOwnedWorkspaceId(
  executor: DbOrTx,
  organizationId: string,
  userId: string
): Promise<string | null> {
  const [oldest] = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workspace.ownerId, userId),
        isNull(workspace.archivedAt)
      )
    )
    .orderBy(asc(workspace.createdAt), asc(workspace.id))
    .limit(1)
  return oldest?.id ?? null
}

/**
 * The owner's personal workspace a retiring personal organization's chats move into: the oldest
 * live workspace they own in it (creation time, then id), or, when they own none, the default
 * workspace a first visit would create, made here in the same transaction.
 */
async function destinationWorkspaceTx(
  tx: DbTransaction,
  organizationId: string,
  userId: string
): Promise<string> {
  const oldest = await oldestOwnedWorkspaceId(tx, organizationId, userId)
  if (oldest) return oldest
  const [owner] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const created = await createDefaultPersonalWorkspaceInTransaction(tx, {
    userId,
    userName: owner?.name,
    personalOrganizationId: organizationId,
  })
  return created.id
}

/**
 * The existing workspace a join would move the user's personal-organization chats into, or null
 * when they have no chats to move or the join would create the workspace. A join that sweeps the
 * joiner's workspaces into a team leaves this one out: in the team, its chats would reach the
 * team's data drains.
 */
export async function findPersonalChatDestinationWorkspaceId(
  executor: DbOrTx,
  userId: string
): Promise<string | null> {
  const [personal] = await executor
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(organization.kind, 'personal')))
    .limit(1)
  if (!personal) return null
  const [anyChat] = await executor
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(
      and(eq(copilotChats.organizationId, personal.organizationId), eq(copilotChats.userId, userId))
    )
    .limit(1)
  if (!anyChat) return null
  return oldestOwnedWorkspaceId(executor, personal.organizationId, userId)
}

/**
 * Moves the owner's organization chats out of their personal organization into their own
 * personal workspace, in the caller's transaction, before the organization's workspaces are
 * detached and it is deleted (joining a team, or the rollback). The chats stay private to their
 * owner as workspace chats, outlive any team they join or leave, and never reach a team's data
 * drains; moving them into the team would have done all three wrong. The workspace is stamped
 * `personalChatsRehomedAt`, which keeps it out of every later team attach, on whatever path.
 *
 * Their live runs are stopped first (the Stop recorded durably under the workspace, so run control
 * keeps answering it after the move), the runs move with their chats, and the private attachments
 * those chats name are rebound from the organization to the workspace, so the uploader can still
 * read them and the upload sweeper keeps them while the workspace exists. A durable outbox event
 * delivers the Stops and moves the worker's copy of the chats, whose stored scope otherwise refuses
 * every later turn. The caller holds the personal organization's row lock, so no chat can be
 * inserted into it before commit.
 */
export async function rehomePersonalOrganizationChatsTx(
  tx: DbTransaction,
  { organizationId, userId }: { organizationId: string; userId: string }
): Promise<RehomedPersonalChats> {
  const ownedChats = and(
    eq(copilotChats.organizationId, organizationId),
    eq(copilotChats.userId, userId)
  )
  const [anyChat] = await tx
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(ownedChats)
    .limit(1)
  if (!anyChat) return { workspaceId: null, chatCount: 0, attachmentCount: 0, rescopeEventIds: [] }

  const workspaceId = await destinationWorkspaceTx(tx, organizationId, userId)
  await tx
    .update(workspace)
    .set({ personalChatsRehomedAt: new Date() })
    .where(eq(workspace.id, workspaceId))
  const stoppedRuns = await stopLiveRunsTx(tx, { userId, organizationId })
  await tx.execute(sql`
    INSERT INTO ${copilotRequestStops} (user_id, workspace_id, stream_id, stopped_at)
    SELECT user_id, ${workspaceId}, stream_id, stopped_at
    FROM ${copilotOrganizationRequestStops}
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
    ON CONFLICT DO NOTHING
  `)
  await tx
    .delete(copilotOrganizationRequestStops)
    .where(
      and(
        eq(copilotOrganizationRequestStops.organizationId, organizationId),
        eq(copilotOrganizationRequestStops.userId, userId)
      )
    )
  await tx
    .update(copilotRuns)
    .set({ workspaceId, organizationId: null })
    .where(and(eq(copilotRuns.organizationId, organizationId), eq(copilotRuns.userId, userId)))
  const moved = await tx
    .update(copilotChats)
    .set({ workspaceId, organizationId: null })
    .where(ownedChats)
    .returning({ id: copilotChats.id })
  const chatIds = moved.map((row) => row.id)

  const attachments = sql`
    jsonb_array_elements(
      CASE WHEN jsonb_typeof(${copilotMessages.content} -> 'fileAttachments') = 'array'
        THEN ${copilotMessages.content} -> 'fileAttachments' ELSE '[]'::jsonb END
    ) AS attachment(value)
  `
  const rebound = await tx.execute<{ id: string }>(sql`
    UPDATE ${uploadSession}
    SET metadata = jsonb_set(
          ${uploadSession.metadata},
          '{organizationAttachment}',
          ((${uploadSession.metadata} -> 'organizationAttachment') - 'organizationId')
            || jsonb_build_object('workspaceId', ${workspaceId}::text)
        ),
        updated_at = now()
    WHERE ${uploadSession.id} IN (
        SELECT attachment.value ->> 'id'
        FROM ${copilotMessages} CROSS JOIN LATERAL ${attachments}
        WHERE ${copilotMessages.chatId}::text IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(chatIds)}::jsonb)
        )
      )
      AND ${uploadSession.purpose} = 'mothership_attachment'
      AND ${uploadSession.workspaceId} IS NULL
      AND ${uploadSession.userId} = ${userId}
      AND ${uploadSession.metadata} -> 'organizationAttachment' ->> 'organizationId' = ${organizationId}
    RETURNING ${uploadSession.id}
  `)

  const rescopeEventIds = await enqueueChatRescopeTx(tx, {
    userId,
    fromOrganizationId: organizationId,
    toWorkspaceId: workspaceId,
    chatIds,
    stoppedRuns: stoppedRuns.map((run) => ({
      id: run.id,
      streamId: run.streamId,
      userId: run.userId,
      chatId: run.chatId,
      desktopDeviceId: run.desktopDeviceId,
    })),
  })
  return {
    workspaceId,
    chatCount: chatIds.length,
    attachmentCount: rebound.length,
    rescopeEventIds,
  }
}
