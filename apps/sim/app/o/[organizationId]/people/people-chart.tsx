'use client'

import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react'
import {
  Button,
  Chip,
  ChipCombobox,
  cn,
  scrollFadeAttributes,
  scrollFadeXClass,
  useScrollEdges,
} from '@sim/emcn'
import { ChevronLeft, ChevronRight, Search } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { EmptyState } from '@/components/empty-state/empty-state'
import { isApiClientError } from '@/lib/api/client/errors'
import { ChartCanvas } from '@/app/o/[organizationId]/people/chart-canvas'
import { ChartEmptyState } from '@/app/o/[organizationId]/people/chart-empty-state'
import { LoadingStatus } from '@/app/o/[organizationId]/people/loading-status'
import {
  peopleParsers,
  peopleUrlKeys,
  serializePeopleView,
} from '@/app/o/[organizationId]/people/search-params'
import { usePeoplePicker } from '@/app/o/[organizationId]/people/use-people-picker'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { ResourceLoadError } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import { usePeopleChart } from '@/hooks/queries/people'
import { useIsMobile } from '@/hooks/use-is-mobile'

interface PeopleChartProps {
  organizationId: string
  onImport?: () => void
  onSync?: () => void
  viewSwitch: ReactNode
}

interface FindPersonProps {
  rootsLabel?: string
  organizationId: string
  onSelect: (id: string) => void
}

function FindPerson({ organizationId, onSelect, rootsLabel }: FindPersonProps) {
  const { search, pickerProps } = usePeoplePicker(organizationId, rootsLabel ? 'roots' : undefined)
  return (
    <ChipCombobox
      aria-label={rootsLabel ? 'Browse top-level teams' : 'Find a person'}
      {...pickerProps}
      overlayContent={
        rootsLabel ?? (
          <span className='flex items-center gap-2'>
            <Search className='size-[14px]' />
            Find a person
          </span>
        )
      }
      overlayLabel={rootsLabel ?? 'Find a person'}
      placeholder={rootsLabel ?? 'Find a person'}
      searchPlaceholder={rootsLabel ? 'Search team leads…' : 'Search name, title or email…'}
      className={rootsLabel ? 'max-w-48' : 'w-44 max-w-full'}
      dropdownWidth={300}
      align='start'
      onChange={onSelect}
      emptyMessage={
        rootsLabel && !search ? 'No top-level teams with reporting lines yet' : 'No matching people'
      }
    />
  )
}

interface ReportingPathProps {
  children: ReactNode
}

function ReportingPath({ children }: ReportingPathProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef, { axis: 'x' })
  return (
    <nav aria-label='Reporting path' className='shrink-0 border-[var(--border)] border-y'>
      <div
        ref={scrollRef}
        className={cn('overflow-x-auto px-4 py-1.5 text-small', scrollFadeXClass)}
        {...scrollFadeAttributes(edges)}
      >
        <div className='flex w-max min-w-full items-center gap-1'>{children}</div>
      </div>
    </nav>
  )
}

export function PeopleChart({ organizationId, viewSwitch, onImport, onSync }: PeopleChartProps) {
  const { organization } = useOrganizationContext()
  const [origin, setView] = useQueryStates(peopleParsers, peopleUrlKeys)
  const { focus, page } = origin
  const size = useIsMobile() ? 1 : 4
  const chart = usePeopleChart(organizationId, focus, Math.max(1, Math.min(page, 1_000_000)), size)
  const notFound = isApiClientError(chart.error) && chart.error.status === 404
  const refused = isApiClientError(chart.error) && chart.error.status < 500
  // A transient refresh failure keeps the chart on screen; a refusal replaces it.
  const branch = refused ? undefined : chart.data
  const profileQuery = serializePeopleView({
    ...origin,
    view: 'chart',
    focus: branch?.person.memberId ?? focus,
    page: branch?.page ?? page,
    panel: null,
  })
  const currentPerson = useRef<HTMLElement | null>(null)
  const previousReports = useRef<HTMLButtonElement>(null)
  const nextReports = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<{
    focus: string
    page: number
    trigger: HTMLElement
    target: 'person' | 'previous' | 'next'
  } | null>(null)
  const focusPerson = useCallback(
    (id: string, event?: MouseEvent<HTMLButtonElement>) => {
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
    if (document.activeElement !== document.body && document.activeElement !== pending.trigger)
      return
    const controls =
      pending.target === 'next'
        ? [nextReports.current, previousReports.current]
        : [previousReports.current, nextReports.current]
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
    <>
      <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2'>
        {viewSwitch}
        <div className='flex max-w-full items-center gap-2'>
          <div className='min-w-0'>
            <FindPerson organizationId={organizationId} onSelect={focusPerson} />
          </div>
          <Chip onClick={(event) => focusPerson('', event)} disabled={!focus && page === 1}>
            My position
          </Chip>
        </div>
      </div>
      {branch && !branch.chain.length && !branch.totalReports ? (
        <div className='flex min-h-0 flex-1 flex-col overflow-y-auto border-[var(--border)] border-t'>
          <ChartEmptyState
            organizationId={organizationId}
            person={branch.person}
            profileQuery={profileQuery}
            onFocus={focusPerson}
            currentPersonRef={setCurrentPerson}
            onImport={onImport}
            onSync={onSync}
          />
        </div>
      ) : branch ? (
        <>
          <ReportingPath>
            <div className='shrink-0'>
              <FindPerson
                organizationId={organizationId}
                rootsLabel={organization.name}
                onSelect={focusPerson}
              />
            </div>
            {branch.chain
              .slice()
              .reverse()
              .map((manager) => (
                <Fragment key={manager.memberId}>
                  <ChevronRight aria-hidden className='size-3 shrink-0 text-[var(--text-muted)]' />
                  <Chip onClick={(event) => focusPerson(manager.memberId, event)}>
                    {manager.name}
                  </Chip>
                </Fragment>
              ))}
            <ChevronRight aria-hidden className='size-3 shrink-0 text-[var(--text-muted)]' />
            <h2
              ref={setCurrentPerson}
              tabIndex={-1}
              aria-current='page'
              className='shrink-0 rounded-sm font-medium text-[var(--text-body)] focus-visible:outline-2 focus-visible:outline-[var(--brand-secondary)]'
            >
              {branch.person.name}
            </h2>
          </ReportingPath>
          <ChartCanvas
            key={`${branch.person.memberId}/${branch.page}/${size}`}
            organizationId={organizationId}
            branch={branch}
            profileQuery={profileQuery}
            onFocus={focusPerson}
          />
          <div
            className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-[var(--border)] border-t px-4 py-2 text-[var(--text-secondary)] text-small'
            aria-live='polite'
          >
            <span>
              {branch.totalReports
                ? `${branch.totalReports} direct report${branch.totalReports === 1 ? '' : 's'}`
                : 'No direct reports'}
            </span>
            {branch.totalReports > size && (
              <div className='flex items-center gap-2'>
                <span className='tabular-nums'>
                  {size === 1
                    ? branch.page
                    : `${(branch.page - 1) * size + 1}–${(branch.page - 1) * size + branch.reports.length}`}{' '}
                  of {branch.totalReports}
                </span>
                <Button
                  ref={previousReports}
                  aria-label='Previous reports'
                  variant='ghost'
                  size='icon'
                  className='pointer-coarse:size-11'
                  disabled={branch.page === 1}
                  onClick={(event) => changePage(branch.page - 1, 'previous', event)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  ref={nextReports}
                  aria-label='Next reports'
                  variant='ghost'
                  size='icon'
                  className='pointer-coarse:size-11'
                  disabled={branch.page * size >= branch.totalReports}
                  onClick={(event) => changePage(branch.page + 1, 'next', event)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        </>
      ) : chart.error ? (
        notFound ? (
          <EmptyState
            title='Person unavailable'
            description='This person is no longer in your organization’s directory.'
            action={
              focus ? (
                <Chip onClick={(event) => focusPerson('', event)}>My position</Chip>
              ) : (
                <Chip onClick={() => void setView({ view: 'directory' })}>Open directory</Chip>
              )
            }
          />
        ) : (
          <ResourceLoadError message={chart.error.message} onRetry={() => void chart.refetch()} />
        )
      ) : (
        <LoadingStatus>Loading org chart…</LoadingStatus>
      )}
    </>
  )
}
