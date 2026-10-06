import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  requirePrincipalSubjectUserId,
  resolvePrincipalSubjectUserId,
  toPrincipalActor,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { resolveEffectiveWorkspacePermission } from '@sim/platform-authz/workspace'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { issueOperations } from '@/lib/issues/application/operations'
import {
  issueEventRecord,
  issueRecord,
  issueResourceRecord,
  issueTicketRecord,
} from '@/lib/issues/application/records'
import { requireIssuesEnabled } from '@/lib/issues/feature-flag'
import {
  allocateIssueNumber,
  deleteIssueCommentInTx,
  deleteIssueResourceInTx,
  deleteIssueTicketInTx,
  getIssueListRow,
  getUserWorkspaceChat,
  getWorkspaceIssueByNumber,
  type IssueEventInsert,
  type IssueListRow,
  type IssueRow,
  type IssueStateGuard,
  type IssueTicketInsert,
  insertIssueEventInTx,
  insertIssueInTx,
  insertIssueResourceInTx,
  insertIssueTicketInTx,
  isWorkspaceResource,
  linkChatToIssueInTx,
  listIssueChats,
  listIssueEvents,
  listIssueResources,
  listIssueTickets,
  listWorkspaceIssues,
  updateIssueInTx,
} from '@/lib/issues/repository'
import {
  formatIssueKey,
  ISSUE_STATUSES,
  type IssueCloseReason,
  type IssuePriority,
  type IssueResourceType,
  parseIssueKey,
} from '@/lib/issues/types'
import { reconcileChatStreamMarkers } from '@/lib/mothership/chat/stream-liveness'
import { createIssueBodyFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

const MAX_TITLE_LENGTH = 200
const MAX_SUMMARY_LENGTH = 500
const MAX_BODY_BYTES = 1024 * 1024

const authorizationOptions = {
  delegation: { audience: 'sim:workspaces', isWithinScope: () => true },
} as const

interface IssueContext extends ActiveWorkspaceApplicationContext {
  issue: IssueRow
}

/** Issues are addressed by their key within a workspace, e.g. `SIM-152`. */
interface IssueInput {
  workspaceId: string
  key: string
}

async function resolveIssueContext({ input }: { input: IssueInput }): Promise<IssueContext> {
  const workspace = await resolveActiveWorkspaceApplicationContext(input.workspaceId)
  const issueNumber = parseIssueKey(input.key)
  const row = issueNumber
    ? await getWorkspaceIssueByNumber(workspace.workspaceId, issueNumber)
    : null
  if (!row) throw new OrchestrationError('not_found', 'Issue not found')
  return { ...workspace, issue: row }
}

/** Called from an unannotated `authorizeResource` arrow, so it never narrows the inferred context. */
const authorizeIssues = (context: { workspaceOrganizationId: string | null }) =>
  requireIssuesEnabled(context.workspaceOrganizationId)

function validateTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new OrchestrationError('validation', 'An issue needs a title')
  if (trimmed.length > MAX_TITLE_LENGTH)
    throw new OrchestrationError('validation', `Titles are at most ${MAX_TITLE_LENGTH} characters`)
  return trimmed
}

function eventBase(principal: Principal, issueId: string) {
  return {
    issueId,
    actor: toPrincipalActor(principal),
    actorUserId: resolvePrincipalSubjectUserId(principal) ?? null,
  }
}

/**
 * Applies a guarded state change and its Activity events in one transaction. A guard miss
 * means another change landed first, which the caller must see rather than overwrite.
 */
async function transition(
  issueId: string,
  guard: IssueStateGuard,
  values: Partial<IssueRow>,
  events: (row: IssueRow) => Omit<IssueEventInsert, 'issueId' | 'actor' | 'actorUserId'>[],
  principal: Principal,
  /** Runs before the issue row is locked, so every path takes the chat's lock before the issue's. */
  claimChat?: (tx: DbTransaction) => Promise<void>
): Promise<IssueRow> {
  return db.transaction(async (tx) => {
    if (claimChat) await claimChat(tx)
    const row = await updateIssueInTx(tx, issueId, guard, values)
    if (!row) throw new OrchestrationError('conflict', 'The issue changed; reload it and try again')
    for (const event of events(row)) {
      await insertIssueEventInTx(tx, { ...eventBase(principal, issueId), ...event })
    }
    return row
  })
}

/** Working chats with a live run, from the same stream markers the chat list reconciles. */
async function runningChatIds(rows: IssueListRow[]): Promise<Set<string>> {
  const candidates = rows.flatMap(({ issue, workingChatStreamId }) =>
    issue.workingChatId ? [{ chatId: issue.workingChatId, streamId: workingChatStreamId }] : []
  )
  if (candidates.length === 0) return new Set()
  const markers = await reconcileChatStreamMarkers(candidates)
  return new Set(
    [...markers.values()].filter((marker) => marker.streamId !== null).map((m) => m.chatId)
  )
}

async function presentRows(rows: IssueListRow[]) {
  const running = await runningChatIds(rows)
  return rows.map((row) => issueRecord(row, running))
}

async function presentIssue(issueId: string) {
  const row = await getIssueListRow(issueId)
  if (!row) throw new OrchestrationError('not_found', 'Issue not found')
  const [record] = await presentRows([row])
  return record
}

/** Called from an unannotated `projectAudit` arrow, so it never narrows the inferred result. */
function auditOf(
  action: (typeof AuditAction)[keyof typeof AuditAction],
  description: string,
  issue: { id: string; key: string; title: string }
) {
  return {
    action,
    resourceType: AuditResourceType.ISSUE,
    resourceId: issue.id,
    resourceName: `${issue.key} ${issue.title}`,
    description,
  }
}

export const listIssues = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.read,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ context }) {
    const rows = await listWorkspaceIssues(context.workspaceId)
    return { issues: await presentRows(rows) }
  },
})

export const getIssueDetail = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.read,
  resolveContext: resolveIssueContext,
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ context }) {
    const issueId = context.issue.id
    const [issue, events, chats, resources, tickets] = await Promise.all([
      presentIssue(issueId),
      listIssueEvents(issueId),
      listIssueChats(issueId),
      listIssueResources(issueId),
      listIssueTickets(issueId),
    ])
    return {
      issue,
      events: events.map(issueEventRecord),
      chats: chats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt.toISOString(),
      })),
      resources: resources.map(issueResourceRecord),
      tickets: tickets.map(issueTicketRecord),
    }
  },
})

export interface CreateIssueInput {
  workspaceId: string
  title: string
  body: string
  priority?: IssuePriority
  /** An automated filer's stable id for the problem; an open issue with it is reused. */
  fingerprint?: string
}

/** Files an issue with its body as an issue-owned workspace document (`context = 'issue'`). */
export const createIssue = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.create,
  resolveContext: ({ input }: { input: CreateIssueInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    const title = validateTitle(input.title)
    if (Buffer.byteLength(input.body, 'utf-8') > MAX_BODY_BYTES)
      throw new OrchestrationError('validation', 'The issue body is larger than 1 MB')
    const userId = requirePrincipalSubjectUserId(principal)
    const fingerprint = input.fingerprint?.trim() || null

    try {
      const { owner } = await createIssueBodyFile({
        workspaceId: context.workspaceId,
        userId,
        content: input.body,
        insertOwner: async (tx, bodyFileId) => {
          const scopeId = context.workspaceOrganizationId ?? context.workspaceId
          const row = await insertIssueInTx(tx, {
            id: generateId(),
            workspaceId: context.workspaceId,
            numberScopeId: scopeId,
            number: await allocateIssueNumber(tx, scopeId, context.workspaceId),
            title,
            bodyFileId,
            priority: input.priority ?? 0,
            createdByActor: toPrincipalActor(principal),
            createdByUserId: userId,
            fingerprint,
          })
          await insertIssueEventInTx(tx, { ...eventBase(principal, row.id), kind: 'created' })
          return row
        },
      })
      return { issue: await presentIssue(owner.id), created: true }
    } catch (error) {
      if (!fingerprint || !isOpenFingerprintConflict(error)) throw error
      const existing = (await listWorkspaceIssues(context.workspaceId)).find(
        (row) => row.issue.fingerprint === fingerprint && row.issue.status !== 'done'
      )
      if (!existing) throw error
      const [issue] = await presentRows([existing])
      return { issue, created: false }
    }
  },
  projectAudit: ({ result }) =>
    result.created ? auditOf(AuditAction.ISSUE_CREATED, 'Filed issue', result.issue) : [],
})

function isOpenFingerprintConflict(error: unknown): boolean {
  return (
    getPostgresErrorCode(error) === '23505' &&
    getPostgresConstraintName(error) === 'issue_open_fingerprint_unique'
  )
}

interface UpdateIssueInput extends IssueInput {
  title?: string
  priority?: IssuePriority
  /** A workspace member, or null to unassign. */
  ownerId?: string | null
}

export const updateIssue = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.update,
  resolveContext: ({ input }: { input: UpdateIssueInput }) => resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    const current = context.issue
    const values: Partial<IssueRow> = {}
    const events: Omit<IssueEventInsert, 'issueId' | 'actor' | 'actorUserId'>[] = []
    if (input.title !== undefined) {
      const title = validateTitle(input.title)
      if (title !== current.title) {
        values.title = title
        events.push({ kind: 'renamed', payload: { from: current.title, to: title } })
      }
    }
    if (input.priority !== undefined && input.priority !== current.priority) {
      values.priority = input.priority
      events.push({
        kind: 'priority_changed',
        payload: { from: current.priority, to: input.priority },
      })
    }
    if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
      if (
        input.ownerId !== null &&
        !(await resolveEffectiveWorkspacePermission(
          input.ownerId,
          context.workspaceId,
          context.workspaceOrganizationId
        ))
      ) {
        throw new OrchestrationError('validation', 'The owner must be a member of this workspace')
      }
      values.ownerId = input.ownerId
      events.push({ kind: 'owner_changed', payload: { from: current.ownerId, to: input.ownerId } })
    }
    if (events.length > 0) {
      const unchanged = {
        ...(values.title === undefined ? {} : { title: current.title }),
        ...(values.priority === undefined ? {} : { priority: current.priority }),
        ...(values.ownerId === undefined ? {} : { ownerId: current.ownerId }),
      }
      await transition(
        current.id,
        { statuses: ISSUE_STATUSES, unchanged },
        values,
        () => events,
        principal
      )
    }
    return { issue: await presentIssue(current.id) }
  },
  projectAudit: ({ context, result }) => {
    const changed =
      result.issue.title !== context.issue.title ||
      result.issue.priority !== context.issue.priority ||
      (result.issue.owner?.id ?? null) !== context.issue.ownerId
    return changed ? [auditOf(AuditAction.ISSUE_UPDATED, 'Updated issue', result.issue)] : []
  },
})

/** Attaches the caller's chat to a new issue; Sim works on it there. */
export const startIssue = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.start,
  resolveContext: ({ input }: { input: IssueInput & { chatId: string } }) =>
    resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    const userId = requirePrincipalSubjectUserId(principal)
    const chat = await getUserWorkspaceChat(db, input.chatId, context.workspaceId, userId)
    if (!chat) throw new OrchestrationError('not_found', 'Chat not found')
    if (chat.issueId && chat.issueId !== context.issue.id)
      throw new OrchestrationError('conflict', 'That chat already works on another issue')
    const now = new Date()
    await transition(
      context.issue.id,
      { statuses: ['inbox'], hasWorkingChat: false },
      {
        status: 'in_progress',
        workingChatId: input.chatId,
        ownerId: context.issue.ownerId ?? userId,
        startedAt: context.issue.startedAt ?? now,
        reviewSummary: null,
      },
      () => [{ kind: 'work_started', payload: { chatId: input.chatId } }],
      principal,
      async (tx) => {
        if (!(await linkChatToIssueInTx(tx, input.chatId, context.issue.id)))
          throw new OrchestrationError(
            'conflict',
            'That chat was deleted or already works on another issue'
          )
      }
    )
    return { issue: await presentIssue(context.issue.id) }
  },
  projectAudit: ({ result }) =>
    auditOf(AuditAction.ISSUE_WORK_STARTED, 'Started work on issue', result.issue),
})

/** The working chat hands the issue back to its owner with a one-line result. */
export const requestIssueReview = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.review,
  resolveContext: ({ input }: { input: IssueInput & { summary: string } }) =>
    resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    // A delegated caller hands back only the issue its own chat is working on; no chat scope, no handoff.
    if (
      principal.kind === 'delegated' &&
      principal.resourceScope?.chatId !== context.issue.workingChatId
    )
      throw new OrchestrationError(
        'conflict',
        'Only the chat working on this issue can hand it back'
      )
    const summary = input.summary.trim()
    if (!summary) throw new OrchestrationError('validation', 'Say what changed for the reviewer')
    if (summary.length > MAX_SUMMARY_LENGTH)
      throw new OrchestrationError(
        'validation',
        `Review summaries are at most ${MAX_SUMMARY_LENGTH} characters`
      )
    await transition(
      context.issue.id,
      {
        statuses: ['in_progress'],
        ...(context.issue.workingChatId ? { workingChatId: context.issue.workingChatId } : {}),
      },
      { status: 'inbox', reviewSummary: summary },
      (row) => [{ kind: 'review_requested', payload: { chatId: row.workingChatId, summary } }],
      principal
    )
    return { issue: await presentIssue(context.issue.id) }
  },
  projectAudit: ({ result }) =>
    auditOf(AuditAction.ISSUE_REVIEW_REQUESTED, 'Requested review', result.issue),
})

export const approveIssue = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.review,
  resolveContext: resolveIssueContext,
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ context, principal }) {
    await transition(
      context.issue.id,
      {
        statuses: ['inbox'],
        hasWorkingChat: true,
        ...(context.issue.workingChatId ? { workingChatId: context.issue.workingChatId } : {}),
      },
      { status: 'done', closeReason: 'completed', completedAt: new Date() },
      () => [{ kind: 'approved' }],
      principal
    )
    return { issue: await presentIssue(context.issue.id) }
  },
  projectAudit: ({ result }) => auditOf(AuditAction.ISSUE_CLOSED, 'Approved issue', result.issue),
})

/** Sends a reviewed issue back to its working chat. */
export const requestIssueChanges = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.review,
  resolveContext: ({ input }: { input: IssueInput & { note?: string } }) =>
    resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    const note = input.note?.trim() || null
    await transition(
      context.issue.id,
      {
        statuses: ['inbox'],
        hasWorkingChat: true,
        ...(context.issue.workingChatId ? { workingChatId: context.issue.workingChatId } : {}),
      },
      { status: 'in_progress', reviewSummary: null },
      () => [{ kind: 'changes_requested', payload: note ? { note } : {} }],
      principal
    )
    return { issue: await presentIssue(context.issue.id) }
  },
  projectAudit: ({ result }) =>
    auditOf(AuditAction.ISSUE_CHANGES_REQUESTED, 'Requested changes', result.issue),
})

export interface CloseIssueInput extends IssueInput {
  reason: IssueCloseReason
  /** Required when the reason is duplicate: the key of the issue it duplicates. */
  duplicateOfKey?: string
}

export const closeIssue = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.close,
  resolveContext: ({ input }: { input: CloseIssueInput }) => resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    let duplicateOf: IssueRow | null = null
    if (input.reason === 'duplicate') {
      const issueNumber = input.duplicateOfKey ? parseIssueKey(input.duplicateOfKey) : null
      duplicateOf = issueNumber
        ? await getWorkspaceIssueByNumber(context.workspaceId, issueNumber)
        : null
      if (!duplicateOf || duplicateOf.id === context.issue.id)
        throw new OrchestrationError('validation', 'Name the issue this one duplicates')
    }
    await transition(
      context.issue.id,
      { statuses: ['inbox', 'in_progress'] },
      {
        status: 'done',
        closeReason: input.reason,
        duplicateOfId: duplicateOf?.id ?? null,
        completedAt: new Date(),
      },
      () => [
        {
          kind: 'closed',
          payload: {
            reason: input.reason,
            ...(duplicateOf ? { duplicateOf: formatIssueKey(duplicateOf.number) } : {}),
          },
        },
      ],
      principal
    )
    return { issue: await presentIssue(context.issue.id) }
  },
  projectAudit: ({ result }) => auditOf(AuditAction.ISSUE_CLOSED, 'Closed issue', result.issue),
})

/** Reopens a closed issue as new; its earlier chats stay linked. */
export const reopenIssue = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.close,
  resolveContext: resolveIssueContext,
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ context, principal }) {
    await transition(
      context.issue.id,
      { statuses: ['done'] },
      {
        status: 'inbox',
        closeReason: null,
        duplicateOfId: null,
        completedAt: null,
        workingChatId: null,
        reviewSummary: null,
      },
      () => [{ kind: 'reopened' }],
      principal
    )
    return { issue: await presentIssue(context.issue.id) }
  },
  projectAudit: ({ result }) => auditOf(AuditAction.ISSUE_REOPENED, 'Reopened issue', result.issue),
})

export interface IssueResourceInput extends IssueInput {
  resourceType: IssueResourceType
  resourceId: string
}

export const addIssueResource = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.update,
  resolveContext: ({ input }: { input: IssueResourceInput }) => resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    if (!(await isWorkspaceResource(context.workspaceId, input.resourceType, input.resourceId)))
      throw new OrchestrationError('not_found', 'That resource is not in this workspace')
    await db.transaction(async (tx) => {
      const added = await insertIssueResourceInTx(
        tx,
        context.issue.id,
        input.resourceType,
        input.resourceId
      )
      if (!added) return
      await insertIssueEventInTx(tx, {
        ...eventBase(principal, context.issue.id),
        kind: 'resource_added',
        payload: { type: input.resourceType, id: input.resourceId },
      })
    })
    return { resources: (await listIssueResources(context.issue.id)).map(issueResourceRecord) }
  },
})

export const removeIssueResource = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.update,
  resolveContext: ({ input }: { input: IssueResourceInput }) => resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    await db.transaction(async (tx) => {
      const removed = await deleteIssueResourceInTx(
        tx,
        context.issue.id,
        input.resourceType,
        input.resourceId
      )
      if (!removed) return
      await insertIssueEventInTx(tx, {
        ...eventBase(principal, context.issue.id),
        kind: 'resource_removed',
        payload: { type: input.resourceType, id: input.resourceId },
      })
    })
    return { resources: (await listIssueResources(context.issue.id)).map(issueResourceRecord) }
  },
})

export const linkIssueTicket = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.update,
  resolveContext: ({ input }: { input: IssueInput & { ticket: IssueTicketInsert } }) =>
    resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    await db.transaction(async (tx) => {
      const linked = await insertIssueTicketInTx(tx, context.issue.id, input.ticket)
      if (!linked) return
      await insertIssueEventInTx(tx, {
        ...eventBase(principal, context.issue.id),
        kind: 'ticket_linked',
        payload: { provider: linked.provider, key: linked.externalKey },
      })
    })
    return { tickets: (await listIssueTickets(context.issue.id)).map(issueTicketRecord) }
  },
})

export const unlinkIssueTicket = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.update,
  resolveContext: ({ input }: { input: IssueInput & { ticketId: string } }) =>
    resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    await db.transaction(async (tx) => {
      const unlinked = await deleteIssueTicketInTx(tx, context.issue.id, input.ticketId)
      if (!unlinked) throw new OrchestrationError('not_found', 'Ticket link not found')
      await insertIssueEventInTx(tx, {
        ...eventBase(principal, context.issue.id),
        kind: 'ticket_unlinked',
        payload: { provider: unlinked.provider, key: unlinked.externalKey },
      })
    })
    return { tickets: (await listIssueTickets(context.issue.id)).map(issueTicketRecord) }
  },
})

const MAX_COMMENT_LENGTH = 10_000

/** Adds a comment to the issue's activity. Comments are for people; they never reach Sim's chats. */
export const addIssueComment = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.update,
  resolveContext: ({ input }: { input: IssueInput & { body: string } }) =>
    resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    const body = input.body.trim()
    if (!body) throw new OrchestrationError('validation', 'A comment cannot be empty')
    if (body.length > MAX_COMMENT_LENGTH)
      throw new OrchestrationError(
        'validation',
        `Comments are at most ${MAX_COMMENT_LENGTH} characters`
      )
    await insertIssueEventInTx(db, {
      ...eventBase(principal, context.issue.id),
      kind: 'commented',
      payload: { body },
    })
    return { events: (await listIssueEvents(context.issue.id)).map(issueEventRecord) }
  },
})

/** Deletes a comment; only its author can. */
export const deleteIssueComment = defineAuthorizedWorkspaceUseCase({
  operation: issueOperations.update,
  resolveContext: ({ input }: { input: IssueInput & { commentId: string } }) =>
    resolveIssueContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => authorizeIssues(context),
  async execute({ input, context, principal }) {
    const userId = requirePrincipalSubjectUserId(principal)
    const deleted = await db.transaction((tx) =>
      deleteIssueCommentInTx(tx, context.issue.id, input.commentId, userId)
    )
    if (!deleted) throw new OrchestrationError('not_found', 'Comment not found')
    return { events: (await listIssueEvents(context.issue.id)).map(issueEventRecord) }
  },
})
