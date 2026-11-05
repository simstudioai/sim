'use client'

import { Fragment, type MouseEvent, useCallback, useLayoutEffect, useRef } from 'react'
import { ChartCanvas } from '@/platform/app/(shell)/people/_components/org-chart/chart-canvas'
import { ChartEmptyState } from '@/platform/app/(shell)/people/_components/org-chart/chart-empty-state'
import styles from '@/platform/app/(shell)/people/_components/org-chart/org-chart.module.css'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  InlineNotice,
  SearchableSelect,
} from '@/platform/design-system/components'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { isGone, useOrgChart, usePeoplePicker } from '@/platform/lib/data/people'

interface OrgChartProps {
  organization: PlatformOrganization
  onImport?: () => void
  onSync?: () => void
}

interface FindPersonProps {
  organizationId: string
  onSelect: (memberId: string) => void
  /** Offers top-level teams under this label rather than searching everyone. */
  rootsLabel?: string
}

function FindPerson({ organizationId, onSelect, rootsLabel }: FindPersonProps) {
  const picker = usePeoplePicker(organizationId, rootsLabel ? 'roots' : undefined)
  const label = rootsLabel ? 'Browse top-level teams' : 'Find a person'
  return (
    <SearchableSelect
      label={label}
      labelHidden
      searchLabel={rootsLabel ? 'Search team leads' : 'Search name, title or email'}
      placeholder={rootsLabel ?? 'Find a person'}
      options={picker.options}
      value={null}
      search={picker.search}
      onValueChange={(next) => {
        if (next) onSelect(next)
      }}
    />
  )
}

type FocusTarget = 'person' | 'previous' | 'next'

export function OrgChart({ organization, onImport, onSync }: OrgChartProps) {
  const organizationId = organization.organization.id
  const chart = useOrgChart(organizationId)
  const { branch, focus, page, size, setView, profileQuery } = chart
  const currentPerson = useRef<HTMLElement | null>(null)
  const previousReports = useRef<HTMLDivElement>(null)
  const nextReports = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<{
    focus: string
    page: number
    trigger: HTMLElement
    target: FocusTarget
  } | null>(null)
  const focusPerson = (id: string, event?: MouseEvent<HTMLButtonElement>) => {
    // `detail === 0` is a keyboard click: focus follows the navigation instead of being lost.
    pendingFocus.current =
      event?.detail === 0
        ? { focus: id, page: 1, trigger: event.currentTarget, target: 'person' }
        : null
    void setView({ focus: id, page: 1, view: 'chart' }, { history: 'push' })
  }
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

  return (
    <section className={styles.chart} aria-label='Org chart'>
      <div className={styles.toolbar}>
        <div className={styles.picker}>
          <FindPerson organizationId={organizationId} onSelect={focusPerson} />
        </div>
        <Button disabled={!focus && page === 1} onClick={(event) => focusPerson('', event)}>
          My position
        </Button>
      </div>
      {branch && !branch.chain.length && !branch.totalReports ? (
        <ChartEmptyState
          organizationId={organizationId}
          person={branch.person}
          profileQuery={profileQuery}
          onFocus={focusPerson}
          currentPersonRef={setCurrentPerson}
          onImport={onImport}
          onSync={onSync}
        />
      ) : branch ? (
        <>
          <nav aria-label='Reporting path' className={styles.path}>
            <div className={styles.picker}>
              <FindPerson
                organizationId={organizationId}
                rootsLabel={organization.organization.name}
                onSelect={focusPerson}
              />
            </div>
            {branch.chain
              .slice()
              .reverse()
              .map((manager) => (
                <Fragment key={manager.memberId}>
                  <Icon name='I032' />
                  <Button
                    variant='quiet'
                    size='compact'
                    onClick={(event) => focusPerson(manager.memberId, event)}
                  >
                    {manager.name}
                  </Button>
                </Fragment>
              ))}
            <Icon name='I032' />
            <h2
              ref={setCurrentPerson}
              className={styles.current}
              tabIndex={-1}
              aria-current='page'
              data-type='T059'
            >
              {branch.person.name}
            </h2>
          </nav>
          <ChartCanvas branch={branch} profileQuery={profileQuery} onFocus={focusPerson} />
          <div className={styles.footer} aria-live='polite' data-type='T060'>
            <span>
              {branch.totalReports
                ? `${branch.totalReports} direct report${branch.totalReports === 1 ? '' : 's'}`
                : 'No direct reports'}
            </span>
            {branch.totalReports > size && (
              <span className={styles.pager}>
                <span>
                  {size === 1
                    ? branch.page
                    : `${(branch.page - 1) * size + 1}–${(branch.page - 1) * size + branch.reports.length}`}{' '}
                  of {branch.totalReports}
                </span>
                <span ref={previousReports}>
                  <IconButton
                    label='Previous reports'
                    icon='I023'
                    disabled={branch.page === 1}
                    onClick={(event) => changePage(branch.page - 1, 'previous', event)}
                  />
                </span>
                <span ref={nextReports}>
                  <IconButton
                    label='Next reports'
                    icon='I102'
                    disabled={branch.page * size >= branch.totalReports}
                    onClick={(event) => changePage(branch.page + 1, 'next', event)}
                  />
                </span>
              </span>
            )}
          </div>
        </>
      ) : chart.error ? (
        isGone(chart.error) ? (
          <EmptyState
            title='Person unavailable'
            description='This person is no longer in your organization’s directory.'
            action={
              focus ? (
                <Button onClick={(event) => focusPerson('', event)}>My position</Button>
              ) : (
                <Button onClick={() => void setView({ view: 'directory' })}>Open directory</Button>
              )
            }
          />
        ) : (
          <InlineNotice
            intent='danger'
            title='Could not load the org chart'
            message={chart.error.message}
            action={
              <Button size='compact' onClick={chart.retry}>
                Retry
              </Button>
            }
          />
        )
      ) : (
        <PeopleStatus>Loading org chart…</PeopleStatus>
      )}
    </section>
  )
}
