import type { IssueStatus, Priority } from '@/app/playground/org/lib/types'

/** Status groups in the order the issues list reads them. */
export const STATUS_ORDER: IssueStatus[] = [
  'in_progress',
  'blocked',
  'todo',
  'backlog',
  'done',
  'canceled',
]

export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}
