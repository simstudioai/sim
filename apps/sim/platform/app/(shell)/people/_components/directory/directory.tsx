'use client'

import { useMemo } from 'react'
import styles from '@/platform/app/(shell)/people/_components/directory/directory.module.css'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import { PersonIdentity } from '@/platform/app/(shell)/people/_components/person-identity/person-identity'
import {
  Button,
  DataTable,
  EmptyState,
  FailureNotice,
  SearchableSelect,
  SearchField,
} from '@/platform/design-system/components'
import { personHref, useDepartmentOptions, usePeopleDirectory } from '@/platform/lib/data/people'

const COLUMNS = [
  { key: 'person', label: 'Person', kind: 'text', primary: true },
  { key: 'department', label: 'Department', kind: 'text', showFrom: 'compact' },
  { key: 'location', label: 'Location', kind: 'text', showFrom: 'wide' },
  { key: 'manager', label: 'Manager', kind: 'text', showFrom: 'wide' },
] as const

interface DirectoryCellProps {
  value: string | null | undefined
}

function DirectoryCell({ value }: DirectoryCellProps) {
  return (
    <span className={value ? undefined : styles.blank} data-type='T043'>
      {value || '—'}
    </span>
  )
}

interface PersonSummaryProps {
  department: string | null
  location: string | null
  manager: string | undefined
}

/** What the table's hidden columns would say, under the person, so a narrow table loses nothing. */
function PersonSummary({ department, location, manager }: PersonSummaryProps) {
  const place = [location, manager && `Reports to ${manager}`].filter(Boolean).join(' · ')
  return (
    <span className={styles.summary} data-type='T052'>
      {department && <span className={styles.summaryDepartment}>{department}</span>}
      {place && <span>{place}</span>}
    </span>
  )
}

interface PeopleDirectoryProps {
  organizationId: string
}

export function PeopleDirectory({ organizationId }: PeopleDirectoryProps) {
  const directory = usePeopleDirectory(organizationId)
  const departments = useDepartmentOptions(organizationId, directory.origin)
  const { originQuery } = directory
  const rows = useMemo(
    () =>
      directory.rows.map((person) => ({
        id: person.memberId,
        values: {},
        cells: {
          person: (
            <span className={styles.personCell}>
              <PersonIdentity person={person} />
              <PersonSummary
                department={person.department}
                location={person.location}
                manager={person.manager?.name}
              />
            </span>
          ),
          department: <DirectoryCell value={person.department} />,
          location: <DirectoryCell value={person.location} />,
          manager: <DirectoryCell value={person.manager?.name} />,
        },
        href: personHref(organizationId, person.memberId, originQuery),
      })),
    [directory.rows, organizationId, originQuery]
  )
  return (
    <section className={styles.directory} aria-label='Directory'>
      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchField
            label='Search people'
            placeholder='Search name, role, or location'
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
        <span className={styles.scope} data-type='T050'>
          People in your organization
        </span>
      </div>
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
            title='No people found'
            description='Try another name, title, email address, or department.'
            action={<Button onClick={directory.clearFilters}>Clear search</Button>}
          />
        )
      ) : (
        <DataTable
          title='People'
          titleHidden
          virtualized
          rowChevron
          columns={COLUMNS}
          rows={rows}
          loadMore={directory.loadMore}
        />
      )}
    </section>
  )
}
