export const ISSUE_STATUSES = ['inbox', 'in_progress', 'done'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const ISSUE_CLOSE_REASONS = ['completed', 'dismissed', 'duplicate'] as const
export type IssueCloseReason = (typeof ISSUE_CLOSE_REASONS)[number]

/** 0 is no priority; 4 is urgent. */
export const ISSUE_PRIORITIES = [0, 1, 2, 3, 4] as const
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  0: 'No priority',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
}

export const ISSUE_RESOURCE_TYPES = [
  'workflow',
  'table',
  'knowledge_base',
  'file',
  'dashboard',
] as const
export type IssueResourceType = (typeof ISSUE_RESOURCE_TYPES)[number]

export const ISSUE_TICKET_PROVIDERS = ['linear', 'jira'] as const
export type IssueTicketProvider = (typeof ISSUE_TICKET_PROVIDERS)[number]

const ISSUE_EVENT_KINDS = [
  'created',
  'renamed',
  'section_added',
  'section_removed',
  'priority_changed',
  'owner_changed',
  'work_started',
  'review_requested',
  'approved',
  'changes_requested',
  'closed',
  'reopened',
  'resource_added',
  'resource_removed',
  'ticket_linked',
  'ticket_unlinked',
  'chat_detached',
  'commented',
] as const
export type IssueEventKind = (typeof ISSUE_EVENT_KINDS)[number]

const ISSUE_KEY_PREFIX = 'SIM'

export function formatIssueKey(issueNumber: number): string {
  return `${ISSUE_KEY_PREFIX}-${issueNumber}`
}

/** The issue number in a key like `SIM-152`; null when it is not one. */
export function parseIssueKey(key: string): number | null {
  const match = new RegExp(`^${ISSUE_KEY_PREFIX}-(\\d{1,9})$`, 'i').exec(key.trim())
  return match ? Number(match[1]) : null
}
