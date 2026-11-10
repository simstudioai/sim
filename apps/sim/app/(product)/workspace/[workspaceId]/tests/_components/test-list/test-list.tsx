'use client'

import { useMemo } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { SearchField } from '@sim/emcn/search-field'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { workspacePath } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import { usePageCommands } from '@/app/(product)/_components/command-menu/page-commands'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { sortActions } from '@/app/(product)/_components/workspace/resource-table/list-menus'
import {
  OwnerCell,
  type ResourceColumn,
  type ResourceRow,
  ResourceTable,
} from '@/app/(product)/_components/workspace/resource-table/resource-table'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import type { WorkspaceRead } from '@/app/(product)/_components/workspace/workspace-session/model'
import { TestStatus } from '@/app/(product)/workspace/[workspaceId]/tests/_components/test-status/test-status'
import { useMinuteClock } from '@/platform/lib/data/clock'
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedSearchSetter,
  useSearchFilterValue,
  useUrlSort,
  useWorkspaceMembersQuery,
} from '@/platform/lib/data/folders'
import {
  testsParsers,
  testsSortParams,
  testsUrlKeys,
  useRunWorkflowTests,
  useWorkflowTests,
  useWorkflowTestsAccess,
  type WorkflowTestRecord,
} from '@/platform/lib/data/workflow-tests'
import { platformHref } from '@/platform/lib/navigation'
import { formatRelativeTime, LOCALE } from '@/platform/shared/time'

const EMPTY_TESTS: WorkflowTestRecord[] = []

const COLUMNS: readonly ResourceColumn[] = [
  { id: 'status', label: 'Status', width: 'compact' },
  { id: 'cases', label: 'Cases', numeric: true, width: 'tight' },
  { id: 'owner', label: 'Created by', optional: true },
  { id: 'lastRun', label: 'Last run', optional: true },
  { id: 'updated', label: 'Last updated', narrow: true },
]

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'cases', label: 'Cases' },
  { id: 'lastRun', label: 'Last run' },
  { id: 'updated', label: 'Last updated' },
] as const

/** When the test last ran: its latest run's end, or its start while it goes. */
function lastRunAt(test: WorkflowTestRecord): string | null {
  const latest = test.recentRuns[0]
  return latest ? (latest.completedAt ?? latest.startedAt) : null
}

const SORT_KEYS: Record<
  (typeof SORTS)[number]['id'],
  (test: WorkflowTestRecord) => string | number
> = {
  name: (test) => test.title.toLowerCase(),
  cases: (test) => test.caseCount,
  lastRun: (test) => lastRunAt(test) ?? '',
  updated: (test) => test.updatedAt,
}

interface TestListProps {
  workspaceId: string
}

/**
 * The workspace's workflow tests: each test's latest outcome, its cases and when it last ran, with
 * Run all against the deployed workflows, as on the legacy page.
 */
export function TestList({ workspaceId }: TestListProps) {
  const searchParams = useSearchParams()
  const now = useMinuteClock()
  const { canEdit } = useWorkflowTestsAccess(workspaceId)
  const testsQuery = useWorkflowTests(workspaceId)
  const tests = testsQuery.data ?? EMPTY_TESTS
  const membersQuery = useWorkspaceMembersQuery(workspaceId)
  const runTests = useRunWorkflowTests(workspaceId)

  const [{ search: searchValue }, setFilters] = useQueryStates(testsParsers, testsUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )
  const search = useSearchFilterValue(searchValue, SEARCH_DEBOUNCE_MS)
  const term = search.trim().toLowerCase()
  const { sort, dir, onSort } = useUrlSort(testsSortParams, testsUrlKeys)

  const memberById = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.userId, member])),
    [membersQuery.data]
  )

  const shown = useMemo(() => {
    const key = SORT_KEYS[sort]
    const direction = dir === 'asc' ? 1 : -1
    return tests
      .filter(
        (test) => !term || test.title.toLowerCase().includes(term) || test.name.includes(term)
      )
      .sort((a, b) => {
        const left = key(a)
        const right = key(b)
        return left < right ? -direction : left > right ? direction : 0
      })
  }, [tests, term, sort, dir])

  const running = runTests.isPending || tests.some((test) => test.status === 'running')
  const runAllDisabled = !canEdit || running || tests.length === 0
  const runAll = () =>
    runTests.mutate({ version: 'deployed' }, { onError: (error) => toast.error(error.message) })

  usePageCommands(
    runAllDisabled ? [] : [{ id: 'tests-run-all', label: 'Run all tests', run: runAll }]
  )

  const rows: ResourceRow[] = shown.map((test) => {
    const owner = test.createdByUserId ? memberById.get(test.createdByUserId) : undefined
    const ranAt = lastRunAt(test)
    return {
      id: test.name,
      name: test.title,
      icon: 'I136',
      href: platformHref(
        `${workspacePath(workspaceId, 'tests')}/${encodeURIComponent(test.name)}`,
        searchParams
      ),
      cells: {
        status: <TestStatus status={test.status} />,
        cases: test.caseCount.toLocaleString(LOCALE),
        owner: owner && <OwnerCell name={owner.name} image={owner.image} />,
        lastRun: ranAt && formatRelativeTime(Date.parse(ranAt), now),
        updated: formatRelativeTime(Date.parse(test.updatedAt), now),
      },
    }
  })

  const controls = (
    <ControlBar
      search={
        <SearchField
          variant='quiet'
          label='Search tests'
          placeholder='Search tests…'
          value={searchValue}
          onValueChange={setSearch}
        />
      }
    >
      <ActionMenu
        label='Sort tests'
        icon='I050'
        tooltip
        align='end'
        actions={sortActions({ columns: SORTS, sort, dir, onSort })}
      />
      <Button
        variant='secondary'
        size='compact'
        icon='play'
        disabled={runAllDisabled}
        onClick={runAll}
      >
        {running ? 'Running…' : 'Run all'}
      </Button>
    </ControlBar>
  )

  const read: WorkspaceRead = testsQuery.isError
    ? {
        status: 'error',
        message: 'Tests could not be loaded.',
        retrying: testsQuery.isFetching,
        onRetry: () => void testsQuery.refetch(),
      }
    : testsQuery.isPending
      ? { status: 'pending' }
      : { status: 'ready' }

  const empty = term ? (
    <WorkspaceEmpty
      title={`No results for “${search.trim()}”`}
      action={{ label: 'Clear search', onClick: () => setSearch('') }}
    />
  ) : (
    <WorkspaceEmpty
      title='No tests yet'
      description='Write tests to check your workflows behave before you deploy.'
    />
  )

  return (
    <LiveWorkspacePage workspaceId={workspaceId} current='tests' controls={controls} read={read}>
      <ResourceTable label='Tests' columns={COLUMNS} rows={rows} empty={empty} />
    </LiveWorkspacePage>
  )
}
