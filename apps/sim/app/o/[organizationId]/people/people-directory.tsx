'use client'

import { useCallback, useMemo, useState } from 'react'
import { Avatar, Chip, ChipCombobox } from '@sim/emcn'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { PersonSummary } from '@/lib/api/contracts/people'
import { organizationRoutes } from '@/lib/navigation/paths'
import { PEOPLE_SEARCH_MAX_LENGTH } from '@/lib/people/validation'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { PEOPLE_COLUMNS, PEOPLE_SEARCH_PLACEHOLDER } from '@/app/o/[organizationId]/people/columns'
import { LoadingStatus } from '@/app/o/[organizationId]/people/loading-status'
import {
  peopleParsers,
  peopleUrlKeys,
  serializePeopleView,
} from '@/app/o/[organizationId]/people/search-params'
import {
  ResourceLoadError,
  ResourceNoResults,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import {
  type FilterTag,
  ResourceFilterPanel,
  ResourceFilterSection,
  type SearchConfig,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import {
  Resource,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useDepartments, usePeople } from '@/hooks/queries/people'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'

/** The filter's value for every department: stored text can't hold a NUL, so no department is this. */
const KEY_PREFIX = '\u0000key:'
const ALL_DEPARTMENTS = '\u0000all'

function personCell(person: PersonSummary) {
  return {
    icon: <Avatar size='xs' name={person.name} src={person.image} aria-hidden />,
    label: person.name,
  }
}

interface PeopleProps {
  organizationId: string
}

export function PeopleDirectory({ organizationId }: PeopleProps) {
  const router = useRouter()
  const [origin, setView] = useQueryStates(peopleParsers, peopleUrlKeys)
  const { search, department, departmentKey } = origin
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setView({ view: 'directory', search: value }, options)
  )
  const debouncedSearch = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const query = debouncedSearch.trim()
  const people = usePeople(organizationId, query, department, { departmentKey })
  const profileQuery = serializePeopleView({ ...origin, view: 'directory', panel: null })
  const profileHref = useCallback(
    (memberId: string) => `${organizationRoutes(organizationId).person(memberId)}${profileQuery}`,
    [organizationId, profileQuery]
  )

  const [departmentSearch, setDepartmentSearch] = useState('')
  const [departmentsOpen, setDepartmentsOpen] = useState(false)
  const departmentTerm = useSearchFilterValue(departmentSearch, SEARCH_DEBOUNCE_MS).trim()
  const departments = useDepartments(organizationId, departmentTerm, departmentsOpen)
  const departmentWaiting = departmentSearch.trim() !== departmentTerm
  const changingFilter = people.isPlaceholderData || query !== search.trim()

  const visiblePages = people.isRefetchError || changingFilter ? undefined : people.data?.pages
  const rows: ResourceRow[] = useMemo(
    () =>
      (visiblePages ?? []).flatMap((page) =>
        page.people.map((person) => ({
          id: person.memberId,
          cells: {
            name: {
              content: (
                <Link
                  href={profileHref(person.memberId)}
                  prefetch={false}
                  onClick={(event) => event.stopPropagation()}
                  className='flex min-w-0 items-center gap-2 rounded-sm text-[var(--text-body)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--brand-secondary)]'
                >
                  <Avatar size='xs' name={person.name} src={person.image} aria-hidden />
                  <span className='truncate' title={person.name}>
                    {person.name}
                  </span>
                </Link>
              ),
            },
            title: { label: person.title },
            department: { label: person.department },
            location: { label: person.location },
            manager: person.manager ? personCell(person.manager) : { label: null },
          },
        }))
      ),
    [visiblePages, profileHref]
  )

  const searchConfig: SearchConfig = {
    value: search,
    maxLength: PEOPLE_SEARCH_MAX_LENGTH,
    onChange: setSearch,
    onClearAll: () => setSearch(''),
    placeholder: PEOPLE_SEARCH_PLACEHOLDER,
  }
  const setDepartment = (value: string) => {
    const keyed = value.startsWith(KEY_PREFIX)
    void setView({
      view: 'directory',
      department: keyed ? null : value,
      departmentKey: keyed ? value.slice(KEY_PREFIX.length) : null,
    })
  }
  const hasDepartment = Boolean(departmentKey || department)
  const selectedValue = departmentKey
    ? `${KEY_PREFIX}${departmentKey}`
    : department || ALL_DEPARTMENTS
  const departmentLabel = departmentKey
    ? (!people.isPlaceholderData && people.data?.pages[0]?.selectedDepartment) ||
      'Selected department'
    : department
  const filterTags: FilterTag[] = hasDepartment
    ? [{ label: `Department: ${departmentLabel}`, onRemove: () => setDepartment('') }]
    : []

  return (
    <>
      <Resource.Options
        search={searchConfig}
        filter={{
          active: hasDepartment,
          content: (
            <ResourceFilterPanel>
              <ResourceFilterSection label='Department'>
                <ChipCombobox
                  options={[
                    { value: ALL_DEPARTMENTS, label: 'All' },
                    ...(departmentWaiting
                      ? []
                      : (departments.data?.pages.flatMap((page) => page.departments) ?? [])
                    ).map(({ name, count, departmentKey: key }) => ({
                      value: key ? `${KEY_PREFIX}${key}` : name,
                      label: `${name} (${count})`,
                    })),
                  ]}
                  value={selectedValue}
                  onChange={(value) => setDepartment(value === ALL_DEPARTMENTS ? '' : value)}
                  overlayContent={departmentLabel || 'All'}
                  overlayLabel={departmentLabel || 'All'}
                  searchable
                  searchMaxLength={PEOPLE_SEARCH_MAX_LENGTH}
                  searchMode='server'
                  onSearchChange={setDepartmentSearch}
                  onOpenChange={setDepartmentsOpen}
                  hasMore={!departmentWaiting && departments.hasNextPage}
                  onLoadMore={() => void departments.fetchNextPage()}
                  isLoadingMore={departments.isFetchingNextPage}
                  isLoading={departmentWaiting || departments.isPending}
                  error={departments.error?.message}
                  searchPlaceholder='Search departments...'
                  emptyMessage='No departments match'
                  className='w-full'
                />
                {departments.isError && (
                  <Chip
                    disabled={departments.isFetching}
                    onClick={() => void departments.refetch()}
                  >
                    Retry departments
                  </Chip>
                )}
              </ResourceFilterSection>
            </ResourceFilterPanel>
          ),
        }}
        filterTags={filterTags}
      />
      <Resource.Table
        virtualized
        columns={PEOPLE_COLUMNS}
        rows={rows}
        onRowClick={(memberId) => router.push(profileHref(memberId))}
        onLoadMore={() => void people.fetchNextPage()}
        hasMore={people.hasNextPage && !changingFilter}
        isLoadingMore={people.isFetchingNextPage}
        isFetching={people.isFetching}
        loadMoreFailed={people.isFetchNextPageError}
        emptyState={
          people.isPending || changingFilter ? (
            <LoadingStatus>Loading people…</LoadingStatus>
          ) : people.isLoadingError || people.isRefetchError ? (
            <ResourceLoadError
              message={people.error.message}
              onRetry={() => void people.refetch()}
            />
          ) : !query && !hasDepartment ? (
            <EmptyState
              title='No people to show'
              description='Organization members and people from a connected directory appear here.'
            />
          ) : (
            <div className='flex min-h-0 flex-1 flex-col [overflow-wrap:anywhere]'>
              <ResourceNoResults
                search={query}
                filterCount={hasDepartment ? 1 : 0}
                searchScope='Searched everyone in your organization.'
                filterScope='No people match the selected department.'
                onClear={() =>
                  void setView({ view: 'directory', search: '', department: '', departmentKey: '' })
                }
              />
            </div>
          )
        }
      />
    </>
  )
}
