import { db } from '@sim/db'
import {
  copilotChats,
  dashboard,
  issue,
  issueCounter,
  issueEvent,
  issueExternalLink,
  issueResource,
  knowledgeBase,
  user,
  userTableDefinitions,
  workflow,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import type {
  IssueEventKind,
  IssueResourceType,
  IssueStatus,
  IssueTicketProvider,
} from '@/lib/issues/types'

export type IssueRow = typeof issue.$inferSelect
export type IssueEventRow = typeof issueEvent.$inferSelect
export type IssueResourceRow = typeof issueResource.$inferSelect
export type IssueTicketRow = typeof issueExternalLink.$inferSelect

/** Done issues listed per workspace; older ones stay reachable by key. */
const LISTED_DONE_ISSUES = 50
/** Activity rows returned with an issue, newest last. */
const ISSUE_EVENT_LIMIT = 200

/** Hands out the next issue number in a numbering scope. */
export async function allocateIssueNumber(tx: DbTransaction, scopeId: string): Promise<number> {
  const [row] = await tx
    .insert(issueCounter)
    .values({ scopeId, lastNumber: 1 })
    .onConflictDoUpdate({
      target: issueCounter.scopeId,
      set: { lastNumber: sql`${issueCounter.lastNumber} + 1` },
    })
    .returning({ lastNumber: issueCounter.lastNumber })
  return row.lastNumber
}

export async function insertIssueInTx(
  tx: DbTransaction,
  values: typeof issue.$inferInsert
): Promise<IssueRow> {
  const [row] = await tx.insert(issue).values(values).returning()
  return row
}

export interface IssueEventInsert {
  issueId: string
  actor: unknown
  actorUserId: string | null
  kind: IssueEventKind
  payload?: Record<string, unknown>
}

export async function insertIssueEventInTx(tx: DbOrTx, event: IssueEventInsert): Promise<void> {
  await tx.insert(issueEvent).values({
    id: generateId(),
    issueId: event.issueId,
    actor: event.actor,
    actorUserId: event.actorUserId,
    kind: event.kind,
    payload: event.payload ?? {},
  })
}

/** An active issue in the workspace by its number (the digits of `SIM-152`). */
export async function getWorkspaceIssueByNumber(
  workspaceId: string,
  issueNumber: number
): Promise<IssueRow | null> {
  const [row] = await db
    .select()
    .from(issue)
    .where(
      and(
        eq(issue.workspaceId, workspaceId),
        eq(issue.number, issueNumber),
        isNull(issue.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

export interface IssueListRow {
  issue: IssueRow
  ownerName: string | null
  creatorName: string | null
  workingChatTitle: string | null
  workingChatStreamId: string | null
}

const creator = alias(user, 'creator')

const issueListColumns = {
  issue,
  ownerName: user.name,
  creatorName: creator.name,
  workingChatTitle: copilotChats.title,
  workingChatStreamId: copilotChats.conversationId,
}

function issueListQuery(executor: DbOrTx) {
  return executor
    .select(issueListColumns)
    .from(issue)
    .leftJoin(user, eq(user.id, issue.ownerId))
    .leftJoin(creator, eq(creator.id, issue.createdByUserId))
    .leftJoin(copilotChats, eq(copilotChats.id, issue.workingChatId))
}

/** Every open issue, plus the most recently closed ones. */
export async function listWorkspaceIssues(workspaceId: string): Promise<IssueListRow[]> {
  const active = and(eq(issue.workspaceId, workspaceId), isNull(issue.deletedAt))
  const [open, done] = await Promise.all([
    issueListQuery(db)
      .where(and(active, ne(issue.status, 'done')))
      .orderBy(desc(issue.updatedAt)),
    issueListQuery(db)
      .where(and(active, eq(issue.status, 'done')))
      .orderBy(desc(issue.completedAt))
      .limit(LISTED_DONE_ISSUES),
  ])
  return [...open, ...done]
}

export async function getIssueListRow(issueId: string): Promise<IssueListRow | null> {
  const [row] = await issueListQuery(db).where(eq(issue.id, issueId)).limit(1)
  return row ?? null
}

export interface IssueStateGuard {
  statuses: readonly IssueStatus[]
  /** Inbox with a working chat is waiting for review; without one it is new. */
  hasWorkingChat?: boolean
  /** Fields that must still hold the values the caller read, so an edit never logs a stale "from". */
  unchanged?: { title?: string; priority?: number; ownerId?: string | null }
}

/**
 * Applies a change only while the issue is still in the state the caller read, so two
 * concurrent transitions cannot both win. Null when the issue moved on.
 */
export async function updateIssueInTx(
  tx: DbTransaction,
  issueId: string,
  guard: IssueStateGuard,
  values: Partial<typeof issue.$inferInsert>
): Promise<IssueRow | null> {
  const chatCondition =
    guard.hasWorkingChat === undefined
      ? undefined
      : guard.hasWorkingChat
        ? isNotNull(issue.workingChatId)
        : isNull(issue.workingChatId)
  const [row] = await tx
    .update(issue)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(issue.id, issueId),
        inArray(issue.status, [...guard.statuses]),
        chatCondition,
        guard.unchanged?.title === undefined ? undefined : eq(issue.title, guard.unchanged.title),
        guard.unchanged?.priority === undefined
          ? undefined
          : eq(issue.priority, guard.unchanged.priority),
        guard.unchanged?.ownerId === undefined
          ? undefined
          : guard.unchanged.ownerId === null
            ? isNull(issue.ownerId)
            : eq(issue.ownerId, guard.unchanged.ownerId),
        isNull(issue.deletedAt)
      )
    )
    .returning()
  return row ?? null
}

export async function listIssueEvents(issueId: string): Promise<IssueEventRow[]> {
  const rows = await db
    .select()
    .from(issueEvent)
    .where(eq(issueEvent.issueId, issueId))
    .orderBy(desc(issueEvent.createdAt))
    .limit(ISSUE_EVENT_LIMIT)
  return rows.reverse()
}

export interface IssueChatRow {
  id: string
  title: string | null
  updatedAt: Date
}

/** Every live chat that has worked on the issue, newest first. */
export async function listIssueChats(issueId: string): Promise<IssueChatRow[]> {
  return db
    .select({ id: copilotChats.id, title: copilotChats.title, updatedAt: copilotChats.updatedAt })
    .from(copilotChats)
    .where(and(eq(copilotChats.issueId, issueId), isNull(copilotChats.deletedAt)))
    .orderBy(desc(copilotChats.updatedAt))
}

/** A live chat in the workspace that the user owns; the only kind that can work on an issue. */
export async function getUserWorkspaceChat(
  executor: DbOrTx,
  chatId: string,
  workspaceId: string,
  userId: string
): Promise<{ id: string; issueId: string | null } | null> {
  const [row] = await executor
    .select({ id: copilotChats.id, issueId: copilotChats.issueId })
    .from(copilotChats)
    .where(
      and(
        eq(copilotChats.id, chatId),
        eq(copilotChats.workspaceId, workspaceId),
        eq(copilotChats.userId, userId),
        eq(copilotChats.type, 'mothership'),
        isNull(copilotChats.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

/** Whether a live (not deleted) issue owns this body file. */
export async function hasLiveIssueForBody(fileId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: issue.id })
    .from(issue)
    .where(and(eq(issue.bodyFileId, fileId), isNull(issue.deletedAt)))
    .limit(1)
  return row !== undefined
}

/** Claims a live chat for this issue; false when it was deleted or another issue holds it. */
export async function linkChatToIssueInTx(
  tx: DbTransaction,
  chatId: string,
  issueId: string
): Promise<boolean> {
  const [claimed] = await tx
    .update(copilotChats)
    .set({ issueId })
    .where(
      and(
        eq(copilotChats.id, chatId),
        isNull(copilotChats.deletedAt),
        or(isNull(copilotChats.issueId), eq(copilotChats.issueId, issueId))
      )
    )
    .returning({ id: copilotChats.id })
  return claimed !== undefined
}

/** Releases a deleted chat's issue; the issue's detach trigger returns it to the inbox. */
export async function detachChatFromIssuesInTx(tx: DbTransaction, chatId: string): Promise<void> {
  await tx.update(issue).set({ workingChatId: null }).where(eq(issue.workingChatId, chatId))
}

export async function listIssueResources(issueId: string): Promise<IssueResourceRow[]> {
  return db
    .select()
    .from(issueResource)
    .where(eq(issueResource.issueId, issueId))
    .orderBy(issueResource.createdAt)
}

/** Deletes a comment its author wrote; null when there is no such comment by that author. */
export async function deleteIssueCommentInTx(
  tx: DbTransaction,
  issueId: string,
  commentId: string,
  authorUserId: string
): Promise<IssueEventRow | null> {
  const [row] = await tx
    .delete(issueEvent)
    .where(
      and(
        eq(issueEvent.id, commentId),
        eq(issueEvent.issueId, issueId),
        eq(issueEvent.kind, 'commented'),
        eq(issueEvent.actorUserId, authorUserId)
      )
    )
    .returning()
  return row ?? null
}

/** True when the resource was newly attached. */
/** Whether a live resource of this type with this id belongs to the workspace. */
const WORKSPACE_RESOURCE_EXISTS: Record<
  IssueResourceType,
  (workspaceId: string, resourceId: string) => Promise<unknown[]>
> = {
  workflow: (workspaceId, id) =>
    db
      .select({ id: workflow.id })
      .from(workflow)
      .where(
        and(eq(workflow.id, id), eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt))
      )
      .limit(1),
  table: (workspaceId, id) =>
    db
      .select({ id: userTableDefinitions.id })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.id, id),
          eq(userTableDefinitions.workspaceId, workspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      )
      .limit(1),
  knowledge_base: (workspaceId, id) =>
    db
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.id, id),
          eq(knowledgeBase.workspaceId, workspaceId),
          isNull(knowledgeBase.deletedAt)
        )
      )
      .limit(1),
  file: (workspaceId, id) =>
    db
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.id, id),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1),
  dashboard: (workspaceId, id) =>
    db
      .select({ id: dashboard.id })
      .from(dashboard)
      .where(and(eq(dashboard.id, id), eq(dashboard.workspaceId, workspaceId)))
      .limit(1),
}

export async function isWorkspaceResource(
  workspaceId: string,
  type: IssueResourceType,
  resourceId: string
): Promise<boolean> {
  return (await WORKSPACE_RESOURCE_EXISTS[type](workspaceId, resourceId)).length > 0
}

export async function insertIssueResourceInTx(
  tx: DbTransaction,
  issueId: string,
  resourceType: IssueResourceType,
  resourceId: string
): Promise<boolean> {
  const rows = await tx
    .insert(issueResource)
    .values({ issueId, resourceType, resourceId })
    .onConflictDoNothing()
    .returning({ issueId: issueResource.issueId })
  return rows.length > 0
}

/** True when the resource was attached and is now removed. */
export async function deleteIssueResourceInTx(
  tx: DbTransaction,
  issueId: string,
  resourceType: IssueResourceType,
  resourceId: string
): Promise<boolean> {
  const rows = await tx
    .delete(issueResource)
    .where(
      and(
        eq(issueResource.issueId, issueId),
        eq(issueResource.resourceType, resourceType),
        eq(issueResource.resourceId, resourceId)
      )
    )
    .returning({ issueId: issueResource.issueId })
  return rows.length > 0
}

export async function listIssueTickets(issueId: string): Promise<IssueTicketRow[]> {
  return db
    .select()
    .from(issueExternalLink)
    .where(eq(issueExternalLink.issueId, issueId))
    .orderBy(issueExternalLink.createdAt)
}

export interface IssueTicketInsert {
  provider: IssueTicketProvider
  externalId: string
  externalKey: string
  url: string
  title?: string | null
  status?: string | null
}

/** The new link, or null when the ticket is already linked. */
export async function insertIssueTicketInTx(
  tx: DbTransaction,
  issueId: string,
  ticket: IssueTicketInsert
): Promise<IssueTicketRow | null> {
  const [row] = await tx
    .insert(issueExternalLink)
    .values({ id: generateId(), issueId, ...ticket })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

/** The removed link, or null when the issue has no such link. */
export async function deleteIssueTicketInTx(
  tx: DbTransaction,
  issueId: string,
  ticketId: string
): Promise<IssueTicketRow | null> {
  const [row] = await tx
    .delete(issueExternalLink)
    .where(and(eq(issueExternalLink.id, ticketId), eq(issueExternalLink.issueId, issueId)))
    .returning()
  return row ?? null
}
