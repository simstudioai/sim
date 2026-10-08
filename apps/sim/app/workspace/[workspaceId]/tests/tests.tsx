'use client'

import { useMemo } from 'react'
import { Chip, toast } from '@sim/emcn'
import { PlayOutline, ShieldCheck } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { WorkflowTestRecord } from '@/lib/api/contracts/workflow-tests'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { ownerCell } from '@/app/workspace/[workspaceId]/components/resource/components/owner-cell'
import { ResourceNoResults } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import type {
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { TestStatusBadge } from '@/app/workspace/[workspaceId]/tests/components/test-status-badge'
import {
  testsParsers,
  testsSortParams,
  testsUrlKeys,
} from '@/app/workspace/[workspaceId]/tests/search-params'
import { useRunWorkflowTests, useWorkflowTests } from '@/hooks/queries/workflow-tests'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'status', header: 'Status' },
  { id: 'cases', header: 'Cases' },
  { id: 'owner', header: 'Created by' },
  { id: 'lastRun', header: 'Last run' },
  { id: 'updated', header: 'Last updated' },
]

const SORT_OPTIONS = [
  { id: 'name', label: 'Name' },
  { id: 'cases', label: 'Cases' },
  { id: 'lastRun', label: 'Last run' },
  { id: 'updated', label: 'Last updated' },
]

function lastRunAt(test: WorkflowTestRecord): string | null {
  const latest = test.recentRuns[0]
  return latest ? (latest.completedAt ?? latest.startedAt) : null
}

const SORT_KEYS: Record<
  (typeof SORT_OPTIONS)[number]['id'],
  (test: WorkflowTestRecord) => string | number
> = {
  name: (test) => test.title.toLowerCase(),
  cases: (test) => test.caseCount,
  lastRun: (test) => lastRunAt(test) ?? '',
  updated: (test) => test.updatedAt,
}

interface TestsProps {
  workspaceId: string
}

export function Tests({ workspaceId }: TestsProps) {
  const router = useRouter()
  const canEdit = useUserPermissionsContext().canEdit === true
  const [{ search }, setFilters] = useQueryStates(testsParsers, testsUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )
  const debouncedSearch = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const { sort, dir, activeSort, onSort, onClear } = useUrlSort(testsSortParams, testsUrlKeys)
  const query = useWorkflowTests(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const runTests = useRunWorkflowTests(workspaceId)

  const membersById = useMemo(
    () => new Map((members ?? []).map((member) => [member.userId, member])),
    [members]
  )

  const tests = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()
    const matching = (query.data ?? []).filter(
      (test) => !term || test.title.toLowerCase().includes(term) || test.name.includes(term)
    )
    const key = SORT_KEYS[sort]
    const direction = dir === 'asc' ? 1 : -1
    return [...matching].sort((a, b) => {
      const left = key(a)
      const right = key(b)
      return left < right ? -direction : left > right ? direction : 0
    })
  }, [query.data, debouncedSearch, sort, dir])

  const rows: ResourceRow[] = useMemo(
    () =>
      tests.map((test) => ({
        id: test.name,
        cells: {
          name: { icon: <ShieldCheck className='size-[14px]' />, label: test.title },
          status: { content: <TestStatusBadge status={test.status} /> },
          cases: { label: String(test.caseCount) },
          owner: ownerCell(test.createdByUserId, membersById),
          lastRun: timeCell(lastRunAt(test)),
          updated: timeCell(test.updatedAt),
        },
      })),
    [tests, membersById]
  )

  const searchConfig: SearchConfig = {
    value: search,
    onChange: setSearch,
    onClearAll: () => setSearch(''),
    placeholder: 'Search tests...',
  }
  const sortConfig: SortConfig = { options: SORT_OPTIONS, active: activeSort, onSort, onClear }
  const running = runTests.isPending || (query.data ?? []).some((test) => test.status === 'running')

  return (
    <Resource>
      <Resource.Header
        icon={ShieldCheck}
        title='Tests'
        actions={[
          {
            id: 'run-all',
            text: running ? 'Running…' : 'Run all',
            icon: PlayOutline,
            disabled: !canEdit || running || (query.data ?? []).length === 0,
            onSelect: () =>
              runTests.mutate(
                { version: 'deployed' },
                { onError: (error) => toast.error(error.message) }
              ),
          },
        ]}
      />
      <Resource.Options search={searchConfig} sort={sortConfig} />
      <Resource.Table
        columns={COLUMNS}
        rows={rows}
        onRowClick={(name) => router.push(`/workspace/${workspaceId}/tests/${name}`)}
        emptyState={
          query.error ? (
            <div role='alert' className='flex flex-col items-center gap-3 p-6'>
              <p className='text-[var(--text-error)] text-small'>{query.error.message}</p>
              <Chip onClick={() => query.refetch()}>Retry</Chip>
            </div>
          ) : debouncedSearch.trim() && query.data?.length ? (
            <ResourceNoResults
              search={debouncedSearch}
              filterCount={0}
              onClear={() => setSearch('')}
            />
          ) : undefined
        }
      />
    </Resource>
  )
}
