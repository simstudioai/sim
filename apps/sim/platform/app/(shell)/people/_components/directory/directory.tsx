'use client'

import { useMemo } from 'react'
import { Button } from '@sim/emcn/button'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice } from '@sim/emcn/status'
import { PageColumn } from '@sim/emcn-platform/page-column'
import styles from '@/platform/app/(shell)/people/_components/directory/directory.module.css'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import { PersonIdentity } from '@/platform/app/(shell)/people/_components/person-identity/person-identity'
import { usePeoplePath } from '@/platform/lib/data/people'
import { personHref, useDepartmentOptions, usePeopleDirectory } from '@/platform/shared/people'

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
  return <span data-type='T043'>{value || '—'}</span>
}

interface PeopleDirectoryProps {
  organizationId: string
}

export function PeopleDirectory({ organizationId }: PeopleDirectoryProps) {
  const directory = usePeopleDirectory(organizationId)
  const departments = useDepartmentOptions(organizationId, directory.origin)
  const { originQuery } = directory
  const peoplePath = usePeoplePath()
  const rows = useMemo(
    () =>
      directory.rows.map((person) => ({
        id: person.memberId,
        values: {},
        cells: {
          person: <PersonIdentity person={person} />,
          department: <DirectoryCell value={person.department} />,
          location: <DirectoryCell value={person.location} />,
          manager: <DirectoryCell value={person.manager?.name} />,
        },
        href: personHref(peoplePath, person.memberId, originQuery),
      })),
    [directory.rows, peoplePath, originQuery]
  )
  return (
    <PageColumn>
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
          <span className={styles.scope} data-type='T050'>
            People in your organization
          </span>
          <div className={styles.department}>
            <SearchableSelect
              label='Department'
              variant='text'
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
    </PageColumn>
  )
}
