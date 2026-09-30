'use client'

import { chipHoverSurfaceClass, cn, OverflowText } from '@sim/emcn'
import Link from 'next/link'
import { DelegateAvatar } from '@/app/playground/org/components/delegate-avatar'
import { AgentStateIcon, PriorityIcon, StatusIcon } from '@/app/playground/org/components/glyphs'
import { STATUS_LABELS, STATUS_ORDER } from '@/app/playground/org/lib/issue-vocabulary'
import type { Project } from '@/app/playground/org/lib/project'
import { useProjectSources } from '@/app/playground/org/lib/project-sources'
import { protoRoutes } from '@/app/playground/org/lib/routes'
import type { Issue } from '@/app/playground/org/lib/types'

/** Sim issues for a project, grouped by status. Tracker links and chats live on the issue page. */
export function IssuesList({ project }: { project: Project }) {
  const issues = useProjectSources().issuesFor(project)
  if (!issues.length)
    return <p className='px-6 py-10 text-[var(--text-muted)] text-small'>No issues yet.</p>
  return (
    <div className='h-full overflow-y-auto px-3 pt-3 pb-8'>
      {STATUS_ORDER.map((status) => {
        const inStatus = [...issues]
          .filter((issue) => issue.status === status)
          .sort((a, b) => (a.priority || 5) - (b.priority || 5))
        if (!inStatus.length) return null
        return (
          <section key={status} className='mb-3'>
            <div className='flex h-8 items-center gap-2 px-3 text-small'>
              <StatusIcon status={status} />
              <span className='text-[var(--text-body)]'>{STATUS_LABELS[status]}</span>
              <span className='text-[var(--text-muted)]'>{inStatus.length}</span>
            </div>
            <div className='flex flex-col gap-[1px]'>
              {inStatus.map((issue) => (
                <IssueRow key={issue.key} issue={issue} projectId={project.id} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function IssueRow({ issue, projectId }: { issue: Issue; projectId: string }) {
  return (
    <Link
      href={protoRoutes.issue(projectId, issue.key)}
      className={cn(
        'flex h-9 items-center gap-3 rounded-lg px-3 text-small',
        chipHoverSurfaceClass
      )}
    >
      <PriorityIcon priority={issue.priority} />
      <span className='w-[64px] shrink-0 text-[var(--text-muted)] tabular-nums'>{issue.key}</span>
      <StatusIcon status={issue.status} />
      <OverflowText label={issue.title} className='min-w-0 flex-1 text-[var(--text-body)]' />
      <span className='flex w-[200px] shrink-0 items-center gap-1.5 whitespace-nowrap text-[var(--text-muted)]'>
        {issue.agent && (
          <>
            <AgentStateIcon state={issue.agent.state} />
            <span className='truncate'>{issue.agent.label}</span>
          </>
        )}
      </span>
      <DelegateAvatar owner={issue.owner} delegate={issue.delegate} />
    </Link>
  )
}
