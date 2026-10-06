import type {
  IssueEventRow,
  IssueListRow,
  IssueResourceRow,
  IssueTicketRow,
} from '@/lib/issues/repository'
import {
  formatIssueKey,
  type IssueCloseReason,
  type IssuePriority,
  type IssueResourceType,
  type IssueStatus,
  type IssueTicketProvider,
} from '@/lib/issues/types'

export type IssueFiler = 'user' | 'sim' | 'workflow'

/** Who filed an issue, from the principal that created it. */
function filerOf(actor: unknown): IssueFiler {
  const kind = (actor as { kind?: string } | null)?.kind
  if (kind === 'system') return 'workflow'
  if (kind === 'delegated') return 'sim'
  return 'user'
}

/**
 * `runningChatIds` holds the working chats with a live run, so "Sim is working" reflects the chat
 * rather than the stored status alone.
 */
export function issueRecord(
  { issue, ownerName, creatorName, workingChatTitle }: IssueListRow,
  runningChatIds: ReadonlySet<string>
) {
  return {
    id: issue.id,
    key: formatIssueKey(issue.number),
    title: issue.title,
    status: issue.status as IssueStatus,
    /** Inbox only: new until Sim works on it, review once Sim hands it back. */
    inboxKind:
      issue.status === 'inbox'
        ? issue.workingChatId
          ? ('review' as const)
          : ('new' as const)
        : null,
    closeReason: issue.closeReason as IssueCloseReason | null,
    duplicateOfId: issue.duplicateOfId,
    priority: issue.priority as IssuePriority,
    owner: issue.ownerId ? { id: issue.ownerId, name: ownerName ?? '' } : null,
    workingChat: issue.workingChatId
      ? {
          id: issue.workingChatId,
          title: workingChatTitle,
          running: runningChatIds.has(issue.workingChatId),
        }
      : null,
    reviewSummary: issue.reviewSummary,
    filedBy: { kind: filerOf(issue.createdByActor), name: creatorName },
    bodyFileId: issue.bodyFileId,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    startedAt: issue.startedAt?.toISOString() ?? null,
    completedAt: issue.completedAt?.toISOString() ?? null,
  }
}

export function issueEventRecord(row: IssueEventRow) {
  return {
    id: row.id,
    kind: row.kind,
    actor: row.actor === null ? null : { kind: filerOf(row.actor), userId: row.actorUserId },
    payload: row.payload as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  }
}

export function issueResourceRecord(row: IssueResourceRow) {
  return {
    type: row.resourceType as IssueResourceType,
    id: row.resourceId,
    createdAt: row.createdAt.toISOString(),
  }
}

export function issueTicketRecord(row: IssueTicketRow) {
  return {
    id: row.id,
    provider: row.provider as IssueTicketProvider,
    externalKey: row.externalKey,
    url: row.url,
    title: row.title,
    status: row.status,
  }
}
