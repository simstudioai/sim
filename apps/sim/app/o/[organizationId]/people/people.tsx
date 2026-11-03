'use client'

import { useMemo, useState } from 'react'
import { Avatar, ChipCombobox } from '@sim/emcn'
import { Users } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { PersonSummary } from '@/lib/api/contracts/people'
import { organizationRoutes } from '@/lib/navigation/paths'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  IMPORT_PEOPLE_ACTION,
  PEOPLE_COLUMNS,
  PEOPLE_SEARCH_PLACEHOLDER,
} from '@/app/o/[organizationId]/people/columns'
import PeopleLoading from '@/app/o/[organizationId]/people/loading'
import { PeopleImportModal } from '@/app/o/[organizationId]/people/people-import-modal'
import { peopleParsers, peopleUrlKeys } from '@/app/o/[organizationId]/people/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
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

/** Everyone in the organization, with the profile facts an admin has recorded or imported. */
export function People({ organizationId }: PeopleProps) {
  const router = useRouter()
  const { viewer } = useOrganizationContext()
  const [{ search, department }, setView] = useQueryStates(peopleParsers, peopleUrlKeys)
  const [importing, setImporting] = useState(false)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setView({ search: value }, options)
  )
  const debouncedSearch = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const query = debouncedSearch.trim()
  const people = usePeople(organizationId, query, department)
  const routes = organizationRoutes(organizationId)

  const departments = useDepartments(organizationId).data ?? []

  const rows: ResourceRow[] = useMemo(
    () =>
      (people.data?.pages ?? []).flatMap((page) =>
        page.people.map((person) => ({
          id: person.memberId,
          cells: {
            name: personCell(person),
            title: { label: person.title },
            department: { label: person.department },
            location: { label: person.location },
            manager: person.manager ? personCell(person.manager) : { label: null },
          },
        }))
      ),
    [people.data]
  )

  const searchConfig: SearchConfig = {
    value: search,
    onChange: setSearch,
    onClearAll: () => setSearch(''),
    placeholder: PEOPLE_SEARCH_PLACEHOLDER,
  }
  const setDepartment = (value: string) => void setView({ department: value })
  const filterTags: FilterTag[] = department
    ? [{ label: `Department: ${department}`, onRemove: () => setDepartment('') }]
    : []

  if (!people.data && !people.isLoadingError) return <PeopleLoading />

  return (
    <Resource>
      <Resource.Header
        icon={Users}
        title='People'
        actions={
          viewer.isAdmin
            ? [
                {
                  ...IMPORT_PEOPLE_ACTION,
                  id: 'import',
                  onSelect: () => setImporting(true),
                },
              ]
            : []
        }
      />
      <Resource.Options
        search={searchConfig}
        filter={{
          active: Boolean(department),
          content: (
            <ResourceFilterPanel>
              <ResourceFilterSection label='Department'>
                <ChipCombobox
                  options={[
                    { value: ALL_DEPARTMENTS, label: 'All' },
                    ...departments.map(({ name, count }) => ({
                      value: name,
                      label: `${name} (${count})`,
                    })),
                  ]}
                  value={department || ALL_DEPARTMENTS}
                  onChange={(value) => setDepartment(value === ALL_DEPARTMENTS ? '' : value)}
                  overlayContent={department || 'All'}
                  searchable
                  searchPlaceholder='Search departments...'
                  emptyMessage='No departments match'
                  className='w-full'
                />
              </ResourceFilterSection>
            </ResourceFilterPanel>
          ),
        }}
        filterTags={filterTags}
      />
      <Resource.Table
        columns={PEOPLE_COLUMNS}
        rows={rows}
        onRowClick={(memberId) => router.push(routes.person(memberId))}
        onLoadMore={() => void people.fetchNextPage()}
        hasMore={people.hasNextPage}
        isLoadingMore={people.isFetchingNextPage}
        isFetching={people.isFetching}
        loadMoreFailed={people.isFetchNextPageError}
        emptyState={
          people.isLoadingError ? (
            <ResourceLoadError
              message={people.error.message}
              onRetry={() => void people.refetch()}
            />
          ) : (
            <ResourceNoResults
              search={query}
              filterCount={department ? 1 : 0}
              searchScope='Searched everyone in your organization.'
              onClear={() => void setView({ search: '', department: '' })}
            />
          )
        }
      />
      {importing && viewer.isAdmin && (
        <PeopleImportModal organizationId={organizationId} onClose={() => setImporting(false)} />
      )}
    </Resource>
  )
}
