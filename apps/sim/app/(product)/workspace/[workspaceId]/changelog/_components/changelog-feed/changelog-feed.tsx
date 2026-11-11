'use client'

import type { ComponentProps } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { PageOverflow } from '@sim/emcn-platform/page-column'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { workspacePath } from '@/lib/navigation/paths'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { ListEnd, type ListEndProps } from '@/app/(product)/_components/workspace/list-end/list-end'
import {
  WorkspaceEmpty,
  WorkspaceTabPage,
} from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import type { WorkspaceRead } from '@/app/(product)/_components/workspace/workspace-session/model'
import {
  useRevealedCount,
  useViewerTimeZone,
} from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { UpdatedStatus } from '@/app/(product)/workspace/[workspaceId]/_components/updated-status/updated-status'
import styles from '@/app/(product)/workspace/[workspaceId]/changelog/_components/changelog-feed/changelog-feed.module.css'
import { usePlatformHref } from '@/platform/lib/platform-href'
import {
  CHANGELOG_PERIODS,
  changelogParams,
  serializeChangelog,
} from '@/platform/lib/workspace-views'
import {
  calendarDayFormatter,
  compareText,
  DAY_MS,
  formatCalendarDate,
  formatClockTime,
} from '@/platform/shared/time'
import type { ChangelogData, ChangelogEntry } from '@/platform/shared/workspace-records'

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

interface ChangelogFeedProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  /** The latest history; the page refreshes itself, so `updatedAt` moves on its own. */
  data: ChangelogData
  /** What an empty history says, and where it sends the reader. */
  empty: ComponentProps<typeof WorkspaceEmpty>
  /** Older entries the server has yet to send, newest first; absent when `data` holds them all. */
  older?: ListEndProps
}

/**
 * What shipped in the workspace, newest first and grouped by day. Only applied work appears; each
 * entry links to its details and, when it came from one, to its issue.
 */
export function ChangelogFeed({ data, read, empty, older }: ChangelogFeedProps) {
  const hrefFor = usePlatformHref()
  const timeZone = useViewerTimeZone()
  const [view, setView] = useQueryStates(changelogParams, { history: 'replace', shallow: true })
  const contributors = [
    ...new Map(
      data.entries.flatMap((entry) =>
        entry.contributor ? [[entry.contributor.id, entry.contributor] as const] : []
      )
    ).values(),
  ].sort((left, right) => compareText(left.name, right.name))
  // A contributor no longer in the history, from an old link, reads as everyone.
  const contributor = contributors.some((person) => person.id === view.contributor)
    ? view.contributor
    : 'all'
  const since = data.referenceTime - PERIOD_DAYS[view.period] * DAY_MS
  const matches = data.entries
    .filter(
      (entry) =>
        entry.appliedAt >= since && (contributor === 'all' || entry.contributor?.id === contributor)
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
    serializeChangelog(hrefFor(`${base}/${encodeURIComponent(id)}`), view)
  // Entries arrive newest first, so once the oldest read precedes the period, none older can match.
  const oldest = data.entries.at(-1)
  const olderMatch = Boolean(older?.hasMore && oldest && oldest.appliedAt >= since)
  const issueHref = (id: string) =>
    hrefFor(workspacePath(data.workspace.id, `issues/${encodeURIComponent(id)}`))

  return (
    <WorkspaceTabPage
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
                {contributors.length > 0 && (
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
                )}
              </>
            }
          >
            <UpdatedStatus updatedAt={data.updatedAt} referenceTime={data.referenceTime} />
          </ControlBar>
        )
      }
    >
      {!data.entries.length ? (
        <WorkspaceEmpty title={empty.title} description={empty.description} action={empty.action} />
      ) : !matches.length && !olderMatch ? (
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
              <PageOverflow>
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
                      {(entry.contributor || entry.issueId || entry.version) && (
                        <div className={styles.attribution} data-type='T052'>
                          {entry.contributor && (
                            <span className={styles.person}>
                              <Avatar
                                name={entry.contributor.name}
                                src={entry.contributor.src}
                                size='inline'
                                decorative
                              />
                              {entry.contributor.name}
                            </span>
                          )}
                          {entry.version && <span>{`v${entry.version}`}</span>}
                          {entry.issueId && (
                            <Link href={issueHref(entry.issueId)} className={styles.issue}>
                              {entry.issueId}
                            </Link>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </PageOverflow>
            </section>
          ))}
          {matches.length > revealed || !older ? (
            <ListEnd hasMore={matches.length > revealed} onLoadMore={revealMore} />
          ) : (
            <ListEnd
              hasMore={olderMatch}
              onLoadMore={older.onLoadMore}
              loading={older.loading}
              error={older.error}
            />
          )}
        </div>
      )}
    </WorkspaceTabPage>
  )
}
