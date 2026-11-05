'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import styles from '@/platform/app/(shell)/people/_components/directory/directory.module.css'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import {
  Button,
  DataTable,
  EmptyState,
  FailureNotice,
  PersonRow,
  RecipientTag,
  SearchableSelect,
  SearchField,
} from '@/platform/design-system/components'
import {
  personHref,
  profileOriginQuery,
  useDepartmentOptions,
  usePeopleDirectory,
} from '@/platform/lib/data/people'

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'title', label: 'Title', kind: 'text', showFrom: 'compact' },
  { key: 'department', label: 'Department', kind: 'text', showFrom: 'compact' },
  { key: 'location', label: 'Location', kind: 'text', showFrom: 'wide' },
  { key: 'manager', label: 'Manager', kind: 'text', showFrom: 'wide' },
] as const

interface PeopleDirectoryProps {
  organizationId: string
}

export function PeopleDirectory({ organizationId }: PeopleDirectoryProps) {
  const router = useRouter()
  const directory = usePeopleDirectory(organizationId)
  const { origin } = directory
  const departments = useDepartmentOptions(organizationId, origin)
  const originQuery = profileOriginQuery(origin, { view: 'directory' })
  const rows = useMemo(
    () =>
      directory.rows.map((person) => ({
        id: person.memberId,
        values: {
          name: person.name,
          title: person.title,
          department: person.department,
          location: person.location,
        },
        cells: {
          name: <PersonRow name={person.name} src={person.image ?? undefined} />,
          manager: person.manager ? (
            <PersonRow name={person.manager.name} src={person.manager.image ?? undefined} />
          ) : (
            '—'
          ),
        },
        onOpen: () => router.push(personHref(person.memberId, originQuery)),
      })),
    [directory.rows, originQuery, router]
  )
  return (
    <section className={styles.directory} aria-label='Directory'>
      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchField
            label='Search people'
            placeholder='Search people...'
            value={directory.search}
            onValueChange={directory.setSearch}
          />
        </div>
        <div className={styles.department}>
          <SearchableSelect
            label='Department'
            labelHidden
            searchLabel='Search departments'
            options={departments.options}
            value={departments.value}
            selectedLabel={directory.departmentLabel || 'All departments'}
            search={departments.search}
            onOpenChange={departments.onOpenChange}
            onValueChange={(next) => directory.setDepartment(departments.parse(next))}
          />
        </div>
      </div>
      {directory.hasDepartment && (
        <div>
          <RecipientTag
            address={`Department: ${directory.departmentLabel}`}
            onRemove={() => directory.setDepartment(null)}
          />
        </div>
      )}
      {directory.loading ? (
        <PeopleStatus>Loading people…</PeopleStatus>
      ) : directory.error ? (
        <FailureNotice
          title='Could not load people'
          message={directory.error.message}
          onRetry={directory.retry}
        />
      ) : rows.length === 0 ? (
        !directory.query && !directory.hasDepartment ? (
          <EmptyState
            title='No people to show'
            description='Organization members and people from a connected directory appear here.'
          />
        ) : (
          <EmptyState
            title={directory.query ? `No results for “${directory.query}”` : 'No results'}
            description={
              directory.hasDepartment
                ? 'No people match the selected department.'
                : 'Searched everyone in your organization.'
            }
            action={<Button onClick={directory.clearFilters}>Clear</Button>}
          />
        )
      ) : (
        <DataTable
          title='People'
          titleHidden
          virtualized
          columns={COLUMNS}
          rows={rows}
          loadMore={directory.loadMore}
        />
      )}
    </section>
  )
}
