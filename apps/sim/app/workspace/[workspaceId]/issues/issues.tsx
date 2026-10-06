'use client'

import { useState } from 'react'
import { ListChecks, Plus } from '@sim/emcn/icons'
import Link from 'next/link'
import { ShimmerText } from '@/components/ui/shimmer-text'
import type { IssueRecord } from '@/lib/api/contracts/issues'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import {
  IssueStatusIcon,
  issueStatusLabel,
  NewIssueModal,
} from '@/app/workspace/[workspaceId]/issues/components'
import { useIssueList } from '@/hooks/queries/issues'

interface IssuesProps {
  workspaceId: string
}

interface IssueGroup {
  id: string
  label: string
  issues: IssueRecord[]
}

/** Needs you first (finished work before new filings), then what Sim is working on, then done. */
function groupIssues(issues: IssueRecord[]): IssueGroup[] {
  const needsYou = issues
    .filter((issue) => issue.status === 'inbox')
    .sort((a, b) => Number(a.inboxKind === 'new') - Number(b.inboxKind === 'new'))
  return [
    { id: 'needs-you', label: 'Needs you', issues: needsYou },
    {
      id: 'in-progress',
      label: 'In progress',
      issues: issues.filter((issue) => issue.status === 'in_progress'),
    },
    { id: 'done', label: 'Done', issues: issues.filter((issue) => issue.status === 'done') },
  ].filter((group) => group.issues.length > 0)
}

function noteFor(issue: IssueRecord): string | null {
  if (issue.status === 'inbox' && issue.inboxKind === 'review') return issue.reviewSummary
  if (issue.status === 'inbox') {
    if (issue.filedBy.kind === 'workflow') return 'Filed by a workflow'
    if (issue.filedBy.kind === 'sim') return 'Filed by Sim'
    return issue.filedBy.name ? `Filed by ${issue.filedBy.name.split(' ')[0]}` : null
  }
  if (issue.status === 'in_progress') return issue.workingChat?.title ?? null
  return null
}

export function Issues({ workspaceId }: IssuesProps) {
  const [creating, setCreating] = useState(false)
  const query = useIssueList(workspaceId)
  const groups = groupIssues(query.data ?? [])

  return (
    <Resource>
      <Resource.Header
        icon={ListChecks}
        title='Issues'
        actions={[
          { text: 'New issue', icon: Plus, variant: 'primary', onSelect: () => setCreating(true) },
        ]}
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto flex max-w-[860px] flex-col gap-10 px-6 py-8'>
          {query.error && !query.data ? (
            <p role='alert' className='text-[var(--text-error)] text-small'>
              {query.error.message}
            </p>
          ) : query.isPending ? null : groups.length === 0 ? (
            <p className='text-[var(--text-muted)] text-small'>No issues</p>
          ) : (
            groups.map((group) => (
              <section key={group.id} aria-labelledby={`issues-${group.id}`}>
                <h2 id={`issues-${group.id}`} className='pb-2 text-[var(--text-muted)] text-small'>
                  {group.label}
                </h2>
                <ul>
                  {group.issues.map((issue) => (
                    <IssueRow key={issue.id} workspaceId={workspaceId} issue={issue} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
      <NewIssueModal workspaceId={workspaceId} open={creating} onOpenChange={setCreating} />
    </Resource>
  )
}

interface IssueRowProps {
  workspaceId: string
  issue: IssueRecord
}

function IssueRow({ workspaceId, issue }: IssueRowProps) {
  const note = noteFor(issue)
  return (
    <li className='border-[var(--border)] border-t last:border-b'>
      <Link
        href={`/workspace/${workspaceId}/issues/${issue.key}`}
        className='group flex items-center gap-4 py-3 text-small'
      >
        <span aria-hidden='true' className='flex size-[14px] shrink-0 items-center justify-center'>
          {issue.status === 'inbox' ? (
            <span className='size-[7px] rounded-full bg-[var(--text-icon-muted)]' />
          ) : (
            <IssueStatusIcon issue={issue} />
          )}
        </span>
        <span className='sr-only'>{issueStatusLabel(issue)}</span>
        <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] group-hover:underline group-hover:underline-offset-4'>
          {issue.title}
        </span>
        {note &&
          (issue.status === 'in_progress' && issue.workingChat?.running ? (
            <ShimmerText className='max-w-[280px] truncate text-caption'>{note}</ShimmerText>
          ) : (
            <span className='max-w-[280px] truncate text-[var(--text-muted)] text-caption'>
              {note}
            </span>
          ))}
        <span className='w-[64px] shrink-0 truncate text-right text-[var(--text-muted)]'>
          {issue.owner?.name.split(' ')[0] ?? ''}
        </span>
      </Link>
    </li>
  )
}
