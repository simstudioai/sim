import Link from 'next/link'
import { PriorityIcon } from '@/app/playground/org/components/glyphs'
import { ISSUES, type Issue, type Workspace } from '@/app/playground/org/lib/mock-data'
import { protoRoutes } from '@/app/playground/org/lib/routes'

type Group = 'needsYou' | 'inProgress' | 'done'

const GROUPS: { id: Group; label: string }[] = [
  { id: 'needsYou', label: 'Needs you' },
  { id: 'inProgress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]

/** Work Sim has picked up; backlog and todo stay in the team's tracker. */
function groupOf(issue: Issue): Group | null {
  if (issue.status === 'done') return 'done'
  if (issue.status !== 'in_progress' && issue.status !== 'blocked') return null
  const state = issue.agent?.state
  return state === 'awaitingInput' || state === 'error' ? 'needsYou' : 'inProgress'
}

/** A plain list of Sim issues: priority, title, and who owns it. */
export function IssuesList({ workspace }: { workspace: Workspace }) {
  const issues = ISSUES.filter((issue) => issue.workspaceId === workspace.id)
  const byGroup = new Map<Group, Issue[]>()
  for (const issue of issues) {
    const group = groupOf(issue)
    if (!group) continue
    byGroup.set(group, [...(byGroup.get(group) ?? []), issue])
  }
  if (!byGroup.size)
    return <p className='px-6 py-10 text-[var(--text-muted)] text-small'>Nothing in progress.</p>

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-[860px] flex-col gap-8 px-6 py-6'>
        {GROUPS.map(({ id, label }) => {
          const rows = byGroup.get(id)
          if (!rows) return null
          return (
            <section key={id} className='flex flex-col'>
              <h2 className='pb-2 text-[var(--text-muted)] text-caption'>{label}</h2>
              {rows.map((issue) => (
                <IssueRow key={issue.key} issue={issue} />
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <Link
      href={protoRoutes.issue(issue.workspaceId, issue.key)}
      className='group flex items-baseline gap-4 border-[var(--border)] border-t py-3 text-small last:border-b'
    >
      <PriorityIcon priority={issue.priority} className='translate-y-[2px]' />
      <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] group-hover:underline group-hover:underline-offset-4'>
        {issue.title}
      </span>
      <span className='w-[64px] shrink-0 text-right text-[var(--text-muted)]'>
        {issue.owner.name.split(' ')[0]}
      </span>
    </Link>
  )
}
