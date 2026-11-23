import type { MouseEvent, RefCallback } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import { ArrowUpRight, ChevronRight, RefreshCw, Upload } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { PersonSummary } from '@/lib/api/contracts/people'
import { organizationRoutes } from '@/lib/navigation/paths'
import { HAIRLINE } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/hairline'
import { usePeople } from '@/hooks/queries/people'

function ReportingLinesGraphic() {
  return (
    <svg viewBox='0 0 244 112' width='244' height='112' fill='none' aria-hidden='true'>
      <path d='M122 35v15q0 6-6 6H61q-6 0-6 6v13m67-25q0 6 6 6h55q6 0 6 6v13' {...HAIRLINE} />
      {[
        [72, 1],
        [5, 75],
        [139, 75],
      ].map(([x, y]) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <rect width='100' height='34' rx='9' fill='var(--bg)' {...HAIRLINE} />
          <circle cx='18' cy='17' r='8' fill='var(--surface-4)' />
          <rect
            x='33'
            y='11'
            width='48'
            height='4'
            rx='2'
            fill='var(--text-muted)'
            opacity='0.42'
          />
          <rect
            x='33'
            y='20'
            width='32'
            height='3'
            rx='1.5'
            fill='var(--text-muted)'
            opacity='0.22'
          />
        </g>
      ))}
    </svg>
  )
}

interface ChartEmptyStateProps {
  profileQuery: string
  organizationId: string
  person: PersonSummary
  onFocus: (memberId: string, event: MouseEvent<HTMLButtonElement>) => void
  currentPersonRef: RefCallback<HTMLAnchorElement>
  onImport?: () => void
  onSync?: () => void
}

export function ChartEmptyState({
  organizationId,
  profileQuery,
  person,
  onFocus,
  currentPersonRef,
  onImport,
  onSync,
}: ChartEmptyStateProps) {
  const roots = usePeople(organizationId, '', '', { scope: 'roots' })
  const firstTeam = roots.isSuccess ? roots.data.pages[0]?.people[0] : undefined
  const emptyOrganization = roots.isSuccess && !firstTeam
  const routes = organizationRoutes(organizationId)

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
        <div className='flex flex-wrap items-center justify-center gap-2'>
          {firstTeam ? (
            <Chip
              variant='primary'
              rightIcon={ChevronRight}
              onClick={(event) => onFocus(firstTeam.memberId, event)}
            >
              Explore a team
            </Chip>
          ) : emptyOrganization && onSync ? (
            <Chip variant='primary' leftIcon={RefreshCw} onClick={onSync}>
              Manage directory sync
            </Chip>
          ) : null}
          {emptyOrganization && onImport && (
            <Chip leftIcon={Upload} onClick={onImport}>
              Import people
            </Chip>
          )}
          <ChipLink
            ref={currentPersonRef}
            href={`${routes.person(person.memberId)}${profileQuery}`}
            aria-label={`View profile for ${person.name}`}
            rightIcon={ArrowUpRight}
          >
            View profile
          </ChipLink>
        </div>
      }
    />
  )
}
