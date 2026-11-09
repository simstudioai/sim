import type { MouseEvent, RefCallback } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import Link from 'next/link'
import { usePeoplePath } from '@/platform/lib/data/people'
import { type PersonSummary, personHref, useChartRoots } from '@/platform/shared/people'

interface ChartEmptyStateProps {
  organizationId: string
  person: PersonSummary
  profileQuery: string
  onFocus: (memberId: string, event: MouseEvent<HTMLButtonElement>) => void
  onBrowseDirectory: () => void
  currentPersonRef: RefCallback<HTMLElement>
  /** Present for an administrator, whose connection is what a first chart waits on. */
  onSync?: () => void
}

export function ChartEmptyState({
  organizationId,
  person,
  profileQuery,
  onFocus,
  onBrowseDirectory,
  currentPersonRef,
  onSync,
}: ChartEmptyStateProps) {
  const peoplePath = usePeoplePath()
  const { firstTeam, emptyOrganization } = useChartRoots(organizationId)
  if (emptyOrganization)
    return (
      <EmptyState
        title='Reporting lines aren’t available yet'
        description={
          onSync
            ? 'Your chart appears once your directory’s first sync finishes. You can still browse people in the directory.'
            : 'You can still browse people in the directory. An organization admin can connect your directory or add reporting lines.'
        }
        action={
          <>
            <Button onClick={onBrowseDirectory}>Browse directory</Button>
            {onSync && <Button onClick={onSync}>Directory sync</Button>}
          </>
        }
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
                href={personHref(peoplePath, person.memberId, profileQuery)}
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
