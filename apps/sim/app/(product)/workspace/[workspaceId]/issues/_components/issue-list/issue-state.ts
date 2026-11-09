import type {
  IssueGroup,
  IssueState,
} from '@/app/(product)/_components/workspace/workspace-session/model'

export const ISSUE_GROUPS: readonly { id: IssueGroup; label: string; initiallyOpen: boolean }[] = [
  { id: 'review', label: 'Needs review', initiallyOpen: true },
  { id: 'progress', label: 'In progress', initiallyOpen: true },
  { id: 'merged', label: 'Merged', initiallyOpen: false },
  { id: 'closed', label: 'Closed', initiallyOpen: false },
]

/** Queued, blocked and failed execution stay In progress until resolved. */
export function issueGroup(state: IssueState): IssueGroup {
  switch (state) {
    case 'needs-review':
    case 'stale':
      return 'review'
    case 'merged':
      return 'merged'
    case 'denied':
    case 'cancelled':
      return 'closed'
    default:
      return 'progress'
  }
}

export const ISSUE_STATE_LABEL: Record<IssueState, string> = {
  'needs-review': 'Needs review',
  queued: 'Queued',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  failed: 'Execution failed',
  stale: 'Stale',
  merged: 'Merged',
  denied: 'Denied',
  cancelled: 'Cancelled',
}

/** The state a row names after its title, where the group alone does not say it. */
export function issueQualifier(state: IssueState) {
  return state === 'needs-review' || state === 'in-progress' || state === 'merged'
    ? undefined
    : ISSUE_STATE_LABEL[state]
}
