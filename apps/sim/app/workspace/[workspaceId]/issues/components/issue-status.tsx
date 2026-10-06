import { Circle, CircleCheck, CirclePause, CircleX } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui/thinking-loader'
import type { IssueRecord } from '@/lib/api/contracts/issues'

/**
 * The issue's state as one glyph: an empty circle when new, a yellow dot waiting for review, Sim's
 * thinking loader while its chat is running (paused when the chat stopped), and a check or cross
 * once closed.
 */
interface IssueStatusIconProps {
  issue: IssueRecord
}

export function IssueStatusIcon({ issue }: IssueStatusIconProps) {
  if (issue.status === 'in_progress')
    return issue.workingChat?.running ? (
      <ThinkingLoader size={14} />
    ) : (
      <CirclePause className='size-[14px] text-[var(--text-icon)]' />
    )
  if (issue.status === 'done') {
    const Icon = issue.closeReason === 'completed' ? CircleCheck : CircleX
    return <Icon className='size-[14px] text-[var(--text-icon)]' />
  }
  if (issue.inboxKind === 'review')
    return <span aria-hidden='true' className='size-[8px] rounded-full bg-[var(--caution)]' />
  return <Circle className='size-[14px] text-[var(--text-icon)]' />
}

const CLOSE_REASON_LABELS = {
  completed: 'Completed',
  dismissed: 'Dismissed',
  duplicate: 'Duplicate',
} as const

/** The state {@link IssueStatusIcon} draws, in words, for assistive technology. */
export function issueStatusLabel(issue: IssueRecord): string {
  if (issue.status === 'in_progress')
    return issue.workingChat?.running ? 'Sim is working' : 'In progress'
  if (issue.status === 'done')
    return issue.closeReason ? CLOSE_REASON_LABELS[issue.closeReason] : 'Done'
  return issue.inboxKind === 'review' ? 'Needs review' : 'New'
}
