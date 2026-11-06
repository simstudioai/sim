import type { MouseEvent, RefCallback } from 'react'
import Link from 'next/link'
import { Button, EmptyState } from '@/platform/design-system/components'
import { type PersonSummary, personHref, useChartRoots } from '@/platform/embedded/lib/data/people'

interface ChartEmptyStateProps {
  organizationId: string
  person: PersonSummary
  profileQuery: string
  onFocus: (memberId: string, event: MouseEvent<HTMLButtonElement>) => void
  onBrowseDirectory: () => void
  currentPersonRef: RefCallback<HTMLElement>
  canSync?: boolean
}

export function ChartEmptyState({
  organizationId,
  person,
  profileQuery,
  onFocus,
  onBrowseDirectory,
  currentPersonRef,
  canSync,
}: ChartEmptyStateProps) {
  const { firstTeam, emptyOrganization } = useChartRoots(organizationId)
  if (emptyOrganization)
    return (
      <EmptyState
        title='Reporting lines aren’t available yet'
        description={
          canSync
            ? 'Your chart appears once your directory’s first sync finishes. You can still browse people in the directory.'
            : 'You can still browse people in the directory. An organization admin can connect your directory or add reporting lines.'
        }
        action={<Button onClick={onBrowseDirectory}>Browse directory</Button>}
      />
    )
  return (
    <EmptyState
      title={`No reporting lines for ${person.name}`}
      description='This person is still part of your organization. Their reporting line appears when it is provided.'
      action={
        <>
          {firstTeam && (
            <Button variant='primary' onClick={(event) => onFocus(firstTeam.memberId, event)}>
              Explore a team
            </Button>
          )}
          <Button
            render={
              <Link
                ref={currentPersonRef}
                href={personHref(organizationId, person.memberId, profileQuery)}
              />
            }
          >
            View profile
          </Button>
        </>
      }
    />
  )
}
