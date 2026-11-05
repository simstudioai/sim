import type { MouseEvent } from 'react'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/people/_components/org-chart/org-chart.module.css'
import { Button, EmptyState } from '@/platform/design-system/components'
import { type PersonSummary, personHref, useChartRoots } from '@/platform/lib/data/people'

function ReportingLinesGraphic() {
  return (
    <svg className={styles.graphic} viewBox='0 0 244 112' role='img' aria-label='Reporting lines'>
      <path d='M122 35v15q0 6-6 6H61q-6 0-6 6v13m67-25q0 6 6 6h55q6 0 6 6v13' />
      <rect x='72' y='1' width='100' height='34' rx='9' />
      <rect x='5' y='75' width='100' height='34' rx='9' />
      <rect x='139' y='75' width='100' height='34' rx='9' />
    </svg>
  )
}

interface ChartEmptyStateProps {
  organizationId: string
  person: PersonSummary
  profileQuery: string
  onFocus: (memberId: string, event: MouseEvent<HTMLButtonElement>) => void
  onImport?: () => void
  onSync?: () => void
}

export function ChartEmptyState({
  organizationId,
  person,
  profileQuery,
  onFocus,
  onImport,
  onSync,
}: ChartEmptyStateProps) {
  const { firstTeam, emptyOrganization } = useChartRoots(organizationId)
  return (
    <EmptyState
      graphic={<ReportingLinesGraphic />}
      title={emptyOrganization ? 'No reporting lines yet' : `No reporting lines for ${person.name}`}
      description={
        emptyOrganization
          ? onImport
            ? 'Connect a directory, import people data, or add a manager to a profile to build your org chart.'
            : 'Teams appear here when an administrator adds managers to people’s profiles.'
          : 'This profile has no visible manager or direct reports.'
      }
      action={
        <div className={styles.emptyActions}>
          {firstTeam ? (
            <Button variant='primary' onClick={(event) => onFocus(firstTeam.memberId, event)}>
              Explore a team
            </Button>
          ) : (
            emptyOrganization &&
            onSync && (
              <Button variant='primary' onClick={onSync}>
                Manage directory sync
              </Button>
            )
          )}
          {emptyOrganization && onImport && <Button onClick={onImport}>Import people</Button>}
          <Button render={<Link href={personHref(person.memberId, profileQuery)} />}>
            View profile
          </Button>
        </div>
      }
    />
  )
}
