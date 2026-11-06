'use client'

import { Fragment, type MouseEvent, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Avatar,
  Button,
  FailureNotice,
  Icon,
  IconButton,
  LoadingRows,
  SearchableSelect,
  SearchCombobox,
} from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import {
  DirectorySources,
  ImportPrompt,
} from '@/platform/embedded/app/(shell)/people/_components/directory-sync/directory-sources'
import { ChartCanvas } from '@/platform/embedded/app/(shell)/people/_components/org-chart/chart-canvas'
import { ChartEmptyState } from '@/platform/embedded/app/(shell)/people/_components/org-chart/chart-empty-state'
import styles from '@/platform/embedded/app/(shell)/people/_components/org-chart/org-chart.module.css'
import { ProfileUnavailable } from '@/platform/embedded/app/(shell)/people/_components/people-page/profile-unavailable'
import {
  type SyncSource,
  useOrgChart,
  usePeoplePicker,
  usePeopleViewer,
} from '@/platform/embedded/lib/data/people'
import { isRefusal } from '@/platform/shared/query-view'

function ReportingLinesGraphic() {
  return (
    <svg className={styles.graphic} viewBox='0 0 112 72' role='img' aria-label='Reporting lines'>
      <path d='M56 24v16M16 48v-2a6 6 0 0 1 6-6h68a6 6 0 0 1 6 6v2' />
      <rect x='40' y='0.5' width='32' height='24' rx='6' data-root='true' />
      <rect x='0.5' y='48' width='32' height='23.5' rx='6' />
      <rect x='79.5' y='48' width='32' height='23.5' rx='6' />
    </svg>
  )
}

interface FindPersonProps {
  organizationId: string
  onSelect: (memberId: string) => void
}

function FindPerson({ organizationId, onSelect }: FindPersonProps) {
  const picker = usePeoplePicker(organizationId)
  const options = useMemo(
    () =>
      picker.people.map((person) => ({
        value: person.memberId,
        label: person.name,
        leading: <Avatar name={person.name} src={person.image ?? undefined} size='row' />,
        details: [person.title || person.email, person.department].filter(
          (detail): detail is string => Boolean(detail)
        ),
      })),
    [picker.people]
  )
  return (
    <SearchCombobox
      label='Find a person'
      placeholder='Find a person'
      heading='People'
      emptyLabel='No people found'
      enterHint='Enter to view in chart'
      options={options}
      search={picker.search}
      onOpenChange={picker.onOpenChange}
      onSelect={onSelect}
    />
  )
}

interface BrowseTeamsProps {
  organizationId: string
  organizationName: string
  onSelect: (memberId: string) => void
}

function BrowseTeams({ organizationId, organizationName, onSelect }: BrowseTeamsProps) {
  const picker = usePeoplePicker(organizationId, 'roots')
  return (
    <SearchableSelect
      label='Browse top-level teams'
      labelHidden
      variant='text'
      searchLabel='Search team leads'
      placeholder={organizationName}
      options={picker.options}
      value={null}
      search={picker.search}
      onOpenChange={picker.onOpenChange}
      onValueChange={(next) => {
        if (next) onSelect(next)
      }}
    />
  )
}

type FocusTarget = 'person' | 'previous' | 'next'

interface OrgChartProps {
  organizationId: string
  /** An administrator with no reporting lines and no connection: the chart offers to start one. */
  firstUse: boolean
  onConnect: (source: SyncSource) => void
  onImport: () => void
  canSync?: boolean
}

export function OrgChart({
  organizationId,
  firstUse,
  onConnect,
  onImport,
  canSync,
}: OrgChartProps) {
  const { organizationName, canProvision } = usePeopleViewer()
  const chart = useOrgChart(organizationId)
  const { branch, focus, page, size, compact, setView, profileQuery } = chart
  const pathEdges = useScrollEdges<HTMLDivElement>('horizontal')
  const currentPerson = useRef<HTMLElement | null>(null)
  const previousReports = useRef<HTMLSpanElement>(null)
  const nextReports = useRef<HTMLSpanElement>(null)
  const pendingFocus = useRef<{
    focus: string
    page: number
    trigger: HTMLElement
    target: FocusTarget
  } | null>(null)
  const focusPerson = useCallback(
    (id: string, event?: MouseEvent<HTMLButtonElement>) => {
      // `detail === 0` is a keyboard click: focus follows the navigation instead of being lost.
      pendingFocus.current =
        event?.detail === 0
          ? { focus: id, page: 1, trigger: event.currentTarget, target: 'person' }
          : null
      void setView({ focus: id, page: 1, view: 'chart' }, { history: 'push' })
    },
    [setView]
  )
  const changePage = (
    value: number,
    target: 'previous' | 'next',
    event: MouseEvent<HTMLButtonElement>
  ) => {
    pendingFocus.current =
      event.detail === 0 ? { focus, page: value, trigger: event.currentTarget, target } : null
    void setView({ page: value })
  }
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!branch || !pending || pending.focus !== focus || pending.page !== page) return
    pendingFocus.current = null
    const active = document.activeElement
    if (active !== document.body && active !== pending.trigger) return
    const pagers = [previousReports.current, nextReports.current].map((slot) =>
      slot?.querySelector('button')
    )
    const controls = pending.target === 'next' ? pagers.reverse() : pagers
    const target =
      pending.target === 'person'
        ? currentPerson.current
        : (controls.find((button) => button && !button.disabled) ?? currentPerson.current)
    target?.focus()
  }, [branch, focus, page])
  const setCurrentPerson = useCallback((element: HTMLElement | null) => {
    currentPerson.current = element
  }, [])
  const browseDirectory = () => void setView({ view: 'directory' }, { history: 'push' })
  const noLines = branch && !branch.chain.length && !branch.totalReports

  if (noLines && firstUse)
    return (
      <section className={styles.firstUse} aria-label='Org chart'>
        <ReportingLinesGraphic />
        <div className={styles.firstUseHeading}>
          <h2 data-type='T076'>Bring your organization into view</h2>
          <p className={styles.firstUseCopy} data-type='T043'>
            Connect your identity provider to keep people and reporting lines current, including
            people who haven’t joined Sim.
          </p>
        </div>
        <DirectorySources canProvision={canProvision} onConnect={onConnect} />
        <ImportPrompt onImport={onImport} />
        <p className={styles.secondary} data-type='T050'>
          You can also edit an existing member’s profile to add their manager.
        </p>
      </section>
    )

  return (
    <section className={styles.chart} aria-label='Org chart'>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <FindPerson organizationId={organizationId} onSelect={focusPerson} />
        </div>
        {branch && !noLines && (
          <nav aria-label='Reporting path' className={styles.pathNav}>
            <div ref={pathEdges} className={styles.path}>
              <BrowseTeams
                organizationId={organizationId}
                organizationName={organizationName}
                onSelect={focusPerson}
              />
              {branch.chain
                .slice()
                .reverse()
                .map((manager) => (
                  <Fragment key={manager.memberId}>
                    <Icon name='I032' />
                    <button
                      type='button'
                      className={styles.crumb}
                      data-type='T043'
                      onClick={(event) => focusPerson(manager.memberId, event)}
                    >
                      {manager.name}
                    </button>
                  </Fragment>
                ))}
              <Icon name='I032' />
              <h2
                ref={setCurrentPerson}
                className={styles.current}
                tabIndex={-1}
                aria-current='page'
                data-type='T043'
              >
                {branch.person.name}
              </h2>
            </div>
          </nav>
        )}
        <div className={styles.position}>
          <Button
            icon='I133'
            disabled={!focus && page === 1}
            onClick={(event) => focusPerson('', event)}
          >
            My position
          </Button>
        </div>
      </div>
      {noLines ? (
        <div className={styles.inset}>
          <ChartEmptyState
            organizationId={organizationId}
            person={branch.person}
            profileQuery={profileQuery}
            onFocus={focusPerson}
            onBrowseDirectory={browseDirectory}
            currentPersonRef={setCurrentPerson}
            canSync={canSync}
          />
        </div>
      ) : branch ? (
        <ChartCanvas
          key={`${branch.person.memberId}/${branch.page}/${size}`}
          organizationId={organizationId}
          branch={branch}
          profileQuery={profileQuery}
          compact={compact}
          onFocus={focusPerson}
          pager={
            branch.totalReports > size && (
              <div className={styles.pager} aria-live='polite'>
                <span ref={previousReports}>
                  <IconButton
                    label='Previous reports'
                    icon='I093'
                    disabled={branch.page === 1}
                    onClick={(event) => changePage(branch.page - 1, 'previous', event)}
                  />
                </span>
                <span className={styles.pagerLabel} data-type='T050'>
                  {size === 1
                    ? branch.page
                    : `${(branch.page - 1) * size + 1}–${(branch.page - 1) * size + branch.reports.length}`}{' '}
                  of {branch.totalReports} direct reports
                </span>
                <span ref={nextReports}>
                  <IconButton
                    label='Next reports'
                    icon='I032'
                    disabled={branch.page * size >= branch.totalReports}
                    onClick={(event) => changePage(branch.page + 1, 'next', event)}
                  />
                </span>
              </div>
            )
          }
        />
      ) : chart.error ? (
        <div className={styles.inset}>
          {isRefusal(chart.error) ? (
            <ProfileUnavailable
              action={
                focus ? (
                  <Button onClick={(event) => focusPerson('', event)}>My position</Button>
                ) : (
                  <Button onClick={browseDirectory}>Back to directory</Button>
                )
              }
            />
          ) : (
            <FailureNotice
              title='Could not load the org chart'
              message={chart.error.message}
              onRetry={chart.retry}
            />
          )}
        </div>
      ) : (
        <LoadingRows label='Loading org chart…' />
      )}
    </section>
  )
}
