'use client'

import { Avatar } from '@sim/emcn/avatar'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import { ListEnd } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/list-end/list-end'
import { RefreshStatus } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/refresh-status/refresh-status'
import {
  WorkspaceEmpty,
  WorkspacePage,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type {
  ChangelogData,
  ChangelogEntry,
  WorkspaceRead,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import {
  useRevealedCount,
  useViewerTimeZone,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed.module.css'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import {
  CHANGELOG_PERIODS,
  changelogParams,
  serializeChangelog,
} from '@/platform/lib/workspace-views'
import {
  calendarDayFormatter,
  DAY_MS,
  formatCalendarDate,
  formatClockTime,
} from '@/platform/shared/time'

const PAGE_SIZE = 30

const PERIOD_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const satisfies readonly { value: (typeof CHANGELOG_PERIODS)[number]; label: string }[]

const PERIOD_DAYS = { all: Number.POSITIVE_INFINITY, '7d': 7, '30d': 30, '90d': 90 }

/** Exactly one label per day: Today, Yesterday or the date. */
function dayLabel(day: string, today: string, yesterday: string) {
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  return formatCalendarDate(day, day.slice(0, 4) === today.slice(0, 4) ? 'long' : 'longFull')
}

interface ChangelogActions {
  refresh: () => void
}

interface ChangelogFeedProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  data: ChangelogData
  actions: ChangelogActions
}

/**
 * What shipped in the workspace, newest first and grouped by day. Only applied work appears; each
 * entry links to its details and to the issue it came from.
 */
export function ChangelogFeed({ data, actions, read }: ChangelogFeedProps) {
  const search = useSearchParams()
  const timeZone = useViewerTimeZone()
  const [view, setView] = useQueryStates(changelogParams, { history: 'replace', shallow: true })
  const contributors = [
    ...new Map(data.entries.map((entry) => [entry.contributor.id, entry.contributor])).values(),
  ].sort((left, right) => left.name.localeCompare(right.name))
  // A contributor no longer in the history, from an old link, reads as everyone.
  const contributor = contributors.some((person) => person.id === view.contributor)
    ? view.contributor
    : 'all'
  const since = data.referenceTime - PERIOD_DAYS[view.period] * DAY_MS
  const matches = data.entries
    .filter(
      (entry) =>
        entry.appliedAt >= since && (contributor === 'all' || entry.contributor.id === contributor)
    )
    .sort((left, right) => right.appliedAt - left.appliedAt)
  const [revealed, revealMore] = useRevealedCount(
    `changelog/${data.workspace.id}/${view.period}/${contributor}`,
    PAGE_SIZE
  )
  const toDay = calendarDayFormatter(timeZone)
  const today = toDay(data.referenceTime)
  const yesterday = toDay(data.referenceTime - DAY_MS)
  const days: { day: string; entries: ChangelogEntry[] }[] = []
  for (const entry of matches.slice(0, revealed)) {
    const day = toDay(entry.appliedAt)
    const group = days.at(-1)
    if (group?.day === day) group.entries.push(entry)
    else days.push({ day, entries: [entry] })
  }
  const base = workspacePath(data.workspace.id, 'changelog')
  const detailHref = (id: string) =>
    serializeChangelog(platformHref(`${base}/${encodeURIComponent(id)}`, search), view)
  const issueHref = (id: string) =>
    platformHref(workspacePath(data.workspace.id, `issues/${encodeURIComponent(id)}`), search)

  return (
    <WorkspacePage
      read={read}
      workspace={data.workspace}
      current='changelog'
      controls={
        data.entries.length > 0 && (
          <ControlBar
            leading={
              <>
                <ChoiceMenu
                  label='Period'
                  options={PERIOD_OPTIONS}
                  value={view.period}
                  onValueChange={(period) =>
                    void setView({
                      period: CHANGELOG_PERIODS.find((value) => value === period) ?? null,
                    })
                  }
                />
                <ChoiceMenu
                  label='Contributor'
                  options={[
                    { value: 'all', label: 'All contributors' },
                    ...contributors.map((person) => ({ value: person.id, label: person.name })),
                  ]}
                  value={contributor}
                  onValueChange={(contributor) =>
                    void setView({ contributor: contributor === 'all' ? null : contributor })
                  }
                />
              </>
            }
          >
            <RefreshStatus
              updatedAt={data.updatedAt}
              referenceTime={data.referenceTime}
              onRefresh={actions.refresh}
            />
          </ControlBar>
        )
      }
    >
      {!data.entries.length ? (
        <WorkspaceEmpty
          title='No changes yet'
          description='Approved issues appear here once their changes are applied.'
          action={{
            label: 'View issues',
            href: platformHref(workspacePath(data.workspace.id, 'issues'), search),
          }}
        />
      ) : !matches.length ? (
        <WorkspaceEmpty
          title='No changes in this view'
          description='Try another period or contributor.'
          action={{ label: 'Clear filters', onClick: () => void setView(null) }}
        />
      ) : (
        <div className={styles.days}>
          {days.map(({ day, entries }) => (
            <section key={day} className={styles.day} aria-label={dayLabel(day, today, yesterday)}>
              <h2 data-type='T059'>{dayLabel(day, today, yesterday)}</h2>
              <ol className={styles.entries}>
                {entries.map((entry) => (
                  <li key={entry.id} className={styles.entry}>
                    <div className={styles.heading}>
                      <h3 data-type='T059'>
                        <Link href={detailHref(entry.id)} className={styles.target}>
                          {entry.title}
                        </Link>
                      </h3>
                      <time
                        className={styles.time}
                        data-type='T052'
                        dateTime={new Date(entry.appliedAt).toISOString()}
                      >
                        {formatClockTime(entry.appliedAt, timeZone)}
                      </time>
                    </div>
                    <p className={styles.description} data-type='T050'>
                      {entry.description}
                    </p>
                    <div className={styles.attribution} data-type='T052'>
                      <span className={styles.person}>
                        <Avatar
                          name={entry.contributor.name}
                          src={entry.contributor.src}
                          size='inline'
                          decorative
                        />
                        {entry.contributor.name}
                      </span>
                      <Link href={issueHref(entry.issueId)} className={styles.issue}>
                        {entry.issueId}
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          <ListEnd hasMore={matches.length > revealed} onLoadMore={revealMore} />
        </div>
      )}
    </WorkspacePage>
  )
}
