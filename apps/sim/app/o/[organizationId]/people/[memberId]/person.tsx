'use client'

import { useState } from 'react'
import { Avatar, Chip, ChipLink } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import Link from 'next/link'
import { isApiClientError } from '@/lib/api/client/errors'
import type { PersonSummary } from '@/lib/api/contracts/people'
import { organizationRoutes } from '@/lib/navigation/paths'
import { PersonModal } from '@/app/o/[organizationId]/people/[memberId]/person-modal'
import { serializePeopleView } from '@/app/o/[organizationId]/people/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
  DetailSection,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsField } from '@/app/workspace/[workspaceId]/settings/components/settings-field'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { usePerson } from '@/hooks/queries/people'

const NOT_RECORDED = <p className='text-[var(--text-muted)] text-sm'>Not recorded</p>

const START_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

/** `2024-01-31` as a calendar date, with how long ago it was: "Jan 31, 2024 · 2 yrs". */
function describeStartDate(startDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`)
  const now = new Date()
  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    start.getUTCMonth() -
    (now.getUTCDate() < start.getUTCDate() ? 1 : 0)
  const tenure =
    months < 0
      ? 'starts soon'
      : months < 1
        ? 'new'
        : months < 12
          ? `${months} mo`
          : `${Math.floor(months / 12)} yr${months >= 24 ? 's' : ''}`
  return `${START_DATE_FORMAT.format(start)} · ${tenure}`
}

interface PersonRowsProps {
  organizationId: string
  people: readonly PersonSummary[]
  empty: string
}

function PersonRows({ organizationId, people, empty }: PersonRowsProps) {
  if (!people.length) return <SettingsEmptyState variant='inline'>{empty}</SettingsEmptyState>
  const routes = organizationRoutes(organizationId)
  return (
    <div className={RESOURCE_LIST_STACK}>
      {people.map((person) => (
        <SettingsResourceRow
          key={person.memberId}
          iconVariant='custom'
          icon={<Avatar size='md' name={person.name} src={person.image} aria-hidden />}
          title={person.name}
          description={person.title ?? person.email}
          href={routes.person(person.memberId)}
          clickLabel={`Open ${person.name}`}
          navigable
        />
      ))}
    </div>
  )
}

interface PersonProps {
  organizationId: string
  memberId: string
}

/** One person's profile: what they do, where they are, and where they sit in the organization. */
export function Person({ organizationId, memberId }: PersonProps) {
  const { viewer } = useOrganizationContext()
  const query = usePerson(organizationId, memberId)
  const [editing, setEditing] = useState(false)
  const routes = organizationRoutes(organizationId)
  const data = query.data

  return (
    <CredentialDetailLayout
      back={
        <ChipLink href={routes.people} leftIcon={ArrowLeft}>
          People
        </ChipLink>
      }
      actions={
        viewer.isAdmin && data ? <Chip onClick={() => setEditing(true)}>Edit</Chip> : undefined
      }
    >
      {query.error ? (
        isApiClientError(query.error) && query.error.status === 404 ? (
          <SettingsEmptyState variant='inline'>
            This person isn't in your organization.
          </SettingsEmptyState>
        ) : (
          <SettingsQueryErrorState
            error={query.error}
            fallback='Could not load this person'
            isRetrying={query.isFetching}
            onRetry={() => void query.refetch()}
            variant='inline'
          />
        )
      ) : !data ? (
        <SettingsEmptyState variant='inline'>Loading…</SettingsEmptyState>
      ) : (
        <>
          <CredentialDetailHeading
            leading={
              <Avatar size='lg' name={data.person.name} src={data.person.image} aria-hidden />
            }
            title={data.person.name}
            subtitle={data.person.title}
          />
          <DetailSection title='Details'>
            <div className='grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2'>
              <SettingsField label='Email'>
                <a
                  className='break-all text-[var(--text-body)] text-sm hover:underline'
                  href={`mailto:${data.person.email}`}
                >
                  {data.person.email}
                </a>
              </SettingsField>
              <SettingsField label='Department'>
                {data.person.department ? (
                  <Link
                    className='text-[var(--text-body)] text-sm hover:underline'
                    href={serializePeopleView(routes.people, {
                      department: data.person.department,
                    })}
                  >
                    {data.person.department}
                  </Link>
                ) : (
                  NOT_RECORDED
                )}
              </SettingsField>
              <SettingsField label='Location'>{data.person.location ?? NOT_RECORDED}</SettingsField>
              <SettingsField label='Start date'>
                {data.person.startDate ? describeStartDate(data.person.startDate) : NOT_RECORDED}
              </SettingsField>
            </div>
          </DetailSection>
          <DetailSection title='Reports to'>
            <PersonRows
              organizationId={organizationId}
              people={data.chain}
              empty={data.person.managerMemberId ? 'Manager is suspended.' : 'No manager recorded.'}
            />
          </DetailSection>
          <DetailSection
            title={
              data.reports.length ? `Direct reports (${data.reports.length})` : 'Direct reports'
            }
          >
            <PersonRows
              organizationId={organizationId}
              people={data.reports}
              empty='No one reports to this person.'
            />
          </DetailSection>
        </>
      )}
      {editing && data && (
        <PersonModal
          organizationId={organizationId}
          person={data.person}
          onClose={() => setEditing(false)}
        />
      )}
    </CredentialDetailLayout>
  )
}
