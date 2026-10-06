import type { IssueRecord } from '@/lib/api/contracts/issues'
import type { V2Issue } from '@/lib/api/contracts/v2/issues'

/** The v2 projection of an issue: ids instead of display names. */
export function toV2Issue(issue: IssueRecord): V2Issue {
  return {
    id: issue.id,
    key: issue.key,
    title: issue.title,
    status: issue.status,
    inboxKind: issue.inboxKind,
    closeReason: issue.closeReason,
    priority: issue.priority,
    ownerId: issue.owner?.id ?? null,
    workingChatId: issue.workingChat?.id ?? null,
    reviewSummary: issue.reviewSummary,
    bodyFileId: issue.bodyFileId,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    startedAt: issue.startedAt,
    completedAt: issue.completedAt,
  }
}
