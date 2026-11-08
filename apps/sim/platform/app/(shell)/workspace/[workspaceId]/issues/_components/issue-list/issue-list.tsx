'use client'

import { useState } from 'react'
import { Disclosure } from '@sim/emcn/disclosure'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchField } from '@sim/emcn/search-field'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import { ListEnd } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/list-end/list-end'
import {
  useNewChatHref,
  WorkspaceEmpty,
  WorkspacePage,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type {
  IssueGroup,
  IssueSummary,
  IssuesData,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useRevealedCount } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/issues/_components/issue-list/issue-list.module.css'
import {
  ISSUE_GROUPS,
  issueGroup,
  issueQualifier,
} from '@/platform/app/(shell)/workspace/[workspaceId]/issues/_components/issue-list/issue-state'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { issueListParams, serializeIssueList } from '@/platform/lib/workspace-views'
import { formatRelativeTime } from '@/platform/shared/time'

const PAGE_SIZE = 40

const SORTS = [
  { id: 'newest', label: 'Created newest first' },
  { id: 'oldest', label: 'Created oldest first' },
  { id: 'title-asc', label: 'Title A–Z' },
  { id: 'title-desc', label: 'Title Z–A' },
] as const

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  ...ISSUE_GROUPS.map((group) => ({ value: group.id, label: group.label })),
]

function compareIssues(sort: (typeof SORTS)[number]['id']) {
  return (left: IssueSummary, right: IssueSummary) => {
    if (sort === 'title-asc' || sort === 'title-desc') {
      const order = left.title.localeCompare(right.title, 'en', { sensitivity: 'base' })
      if (order) return sort === 'title-asc' ? order : -order
    } else if (left.createdAt !== right.createdAt) {
      return sort === 'oldest' ? left.createdAt - right.createdAt : right.createdAt - left.createdAt
    }
    return right.number - left.number
  }
}

interface IssueListProps {
  data: IssuesData
}

/**
 * Agent-proposed issues in four fixed groups. Merged and Closed start collapsed; a filter or search
 * hides groups it empties. Each row opens the issue, carrying this view so Back returns to it.
 */
export function IssueList({ data }: IssueListProps) {
  const search = useSearchParams()
  const newChat = useNewChatHref(data.workspace.id)
  const [view, setView] = useQueryStates(issueListParams, { history: 'replace', shallow: true })
  const [toggled, setToggled] = useState<Partial<Record<IssueGroup, boolean>>>({})
  const listPath = workspacePath(data.workspace.id, 'issues')
  const term = view.q.trim().toLowerCase()
  const filtering = Boolean(term) || view.status !== 'all'
  const [revealed, revealMore] = useRevealedCount(
    `issues/${data.workspace.id}/${term}/${view.status}/${view.sort}`,
    PAGE_SIZE
  )
  const matches = data.issues
    .filter(
      (issue) =>
        (view.status === 'all' || issueGroup(issue.state) === view.status) &&
        (!term || issue.title.toLowerCase().includes(term) || issue.id.toLowerCase().includes(term))
    )
    .sort(compareIssues(view.sort))
  let budget = revealed
  let hidden = 0
  const groups = ISSUE_GROUPS.map((group) => {
    const issues = matches.filter((issue) => issueGroup(issue.state) === group.id)
    const open = toggled[group.id] ?? (filtering || group.initiallyOpen)
    const shown = open ? issues.slice(0, Math.max(0, budget)) : []
    if (open) {
      budget -= shown.length
      hidden += issues.length - shown.length
    }
    return { ...group, issues, open, shown }
  }).filter((group) => !filtering || group.issues.length > 0)

  const rowHref = (id: string) =>
    serializeIssueList(platformHref(`${listPath}/${encodeURIComponent(id)}`, search), view)
  const clearHref = platformHref(listPath, search)
  const controls = data.issues.length > 0 && (
    <ControlBar
      leading={
        <SearchField
          variant='quiet'
          label='Search issues'
          placeholder='Search title or workspace issue ID'
          value={view.q}
          onValueChange={(q) => void setView({ q: q || null })}
        />
      }
    >
      <ChoiceMenu
        label='Status'
        options={STATUS_OPTIONS}
        value={view.status}
        onValueChange={(status) =>
          void setView({ status: ISSUE_GROUPS.find((group) => group.id === status)?.id ?? null })
        }
      />
      <ActionMenu
        label='Sort issues'
        icon='I050'
        tooltip
        actions={SORTS.map((sort) => ({
          id: sort.id,
          label: sort.label,
          checked: view.sort === sort.id,
          onSelect: () => void setView({ sort: sort.id === 'newest' ? null : sort.id }),
        }))}
      />
    </ControlBar>
  )

  return (
    <WorkspacePage workspace={data.workspace} current='issues' controls={controls}>
      {!data.issues.length ? (
        <WorkspaceEmpty
          title='No issues yet'
          description='Agents propose issues here when they find a way to improve this workspace.'
          action={{ label: 'New chat', href: newChat }}
        />
      ) : !matches.length ? (
        <WorkspaceEmpty
          title='No matching issues'
          description='Try a different title or issue ID.'
          action={{ label: 'Clear filters', href: clearHref }}
        />
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <div key={group.id} className={styles.group}>
              <Disclosure
                variant='navigation'
                label={group.label}
                open={group.open}
                onOpenChange={(open) => setToggled((current) => ({ ...current, [group.id]: open }))}
                actions={
                  group.open && (
                    <span className={styles.createdLabel} data-type='T052' aria-hidden='true'>
                      Created
                    </span>
                  )
                }
              >
                <ul className={styles.rows} aria-label={group.label}>
                  {group.shown.map((issue) => {
                    const qualifier = issueQualifier(issue.state)
                    return (
                      <li key={issue.id}>
                        <Link href={rowHref(issue.id)} className={styles.row}>
                          <span className={styles.id} data-type='T060'>
                            {issue.id}
                          </span>
                          <span className={styles.title} data-type='T060'>
                            {issue.title}
                            {qualifier && <span className={styles.qualifier}> {qualifier}</span>}
                          </span>
                          <span className={styles.created} data-type='T060'>
                            {formatRelativeTime(issue.createdAt, data.referenceTime)}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </Disclosure>
            </div>
          ))}
          <ListEnd hasMore={hidden > 0} onLoadMore={revealMore} />
        </div>
      )}
    </WorkspacePage>
  )
}
