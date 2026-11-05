'use client'

import { useMemo } from 'react'
import { PEOPLE_SEARCH_MAX_LENGTH } from '@/lib/people/validation'
import styles from '@/platform/app/(shell)/people/_components/directory/directory.module.css'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  FailureNotice,
  OverflowText,
  RecipientTag,
  SearchableSelect,
  SearchField,
  TableLabel,
} from '@/platform/design-system/components'
import {
  personHref,
  profileOriginQuery,
  useDepartmentOptions,
  usePeopleDirectory,
} from '@/platform/lib/data/people'

type PersonSummaryRow = ReturnType<typeof usePeopleDirectory>['rows'][number]

const COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'title', label: 'Title', kind: 'text', showFrom: 'compact' },
  { key: 'department', label: 'Department', kind: 'text', showFrom: 'compact' },
  { key: 'location', label: 'Location', kind: 'text', showFrom: 'wide' },
  { key: 'manager', label: 'Manager', kind: 'text', showFrom: 'wide' },
] as const

function PersonLabel({ person }: { person: { name: string; image: string | null } }) {
  return (
    <TableLabel
      leading={
        <Avatar size='inline' name={person.name} src={person.image ?? undefined} decorative />
      }
    >
      <OverflowText text={person.name}>{person.name}</OverflowText>
    </TableLabel>
  )
}

function joinFacts(facts: readonly (string | null | undefined)[]) {
  return facts.filter(Boolean).join(' · ')
}

/** What the table's hidden columns would say, under the name, so a narrow table loses nothing. */
function PersonSummary({ person }: { person: PersonSummaryRow }) {
  const role = joinFacts([person.title, person.department])
  const place = joinFacts([person.location, person.manager && `Reports to ${person.manager.name}`])
  return (
    <span className={styles.summary} data-type='T052'>
      {role && (
        <span className={styles.summaryRole}>
          <OverflowText text={role}>{role}</OverflowText>
        </span>
      )}
      {place && <OverflowText text={place}>{place}</OverflowText>}
    </span>
  )
}

interface PeopleDirectoryProps {
  organizationId: string
}

export function PeopleDirectory({ organizationId }: PeopleDirectoryProps) {
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
          name: (
            <span className={styles.nameCell}>
              <PersonLabel person={person} />
              <PersonSummary person={person} />
            </span>
          ),
          manager: person.manager ? <PersonLabel person={person.manager} /> : undefined,
        },
        href: personHref(organizationId, person.memberId, originQuery),
        prefetch: false,
      })),
    [directory.rows, organizationId, originQuery]
  )
  return (
    <section className={styles.directory} aria-label='Directory'>
      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchField
            label='Search people'
            placeholder='Search people…'
            maxLength={PEOPLE_SEARCH_MAX_LENGTH}
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
          <EmptyState title='No people to show' />
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
