'use client'

import { useState } from 'react'
import { Avatar, Chip, ChipLink } from '@sim/emcn'
import { ArrowLeft, Workflow } from '@sim/emcn/icons'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import type { PersonSummary } from '@/lib/api/contracts/people'
import { organizationRoutes } from '@/lib/navigation/paths'
import { PersonModal } from '@/app/o/[organizationId]/people/[memberId]/person-modal'
import { peopleParsers, serializePeopleView } from '@/app/o/[organizationId]/people/search-params'
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

const SOURCE_NAMES = {
  scim: 'SCIM provisioning',
  okta: 'Okta',
  entra: 'Microsoft Entra ID',
} as const
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
  originQuery: string
  people: readonly PersonSummary[]
  empty: string
}

function PersonRows({ organizationId, originQuery, people, empty }: PersonRowsProps) {
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
          href={`${routes.person(person.memberId)}${originQuery}`}
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
  const [origin] = useQueryStates(peopleParsers)
  const query = usePerson(organizationId, memberId)
  const [editing, setEditing] = useState(false)
  const routes = organizationRoutes(organizationId)
  const originQuery = serializePeopleView({ ...origin, view: origin.view ?? 'directory' })
  const notFound = isApiClientError(query.error) && query.error.status === 404
  const refused = isApiClientError(query.error) && query.error.status < 500
  // A transient refresh failure keeps the loaded profile and any edit open on it; a refusal does not.
  const loadError = query.data && !refused ? null : query.error
  const data = loadError ? undefined : query.data

  const chartHref = serializePeopleView(routes.people, {
    ...origin,
    view: 'chart',
    focus: data?.person.memberId ?? memberId,
    page: origin.focus === data?.person.memberId ? origin.page : 1,
    panel: null,
  })
  return (
    <CredentialDetailLayout
      back={
        <ChipLink href={`${routes.people}${originQuery}`} leftIcon={ArrowLeft}>
          People
        </ChipLink>
      }
      actions={
        data ? (
          <>
            <ChipLink leftIcon={Workflow} href={chartHref}>
              View in org chart
            </ChipLink>
            {viewer.isAdmin && !data.person.directorySource && (
              <Chip onClick={() => setEditing(true)}>Edit</Chip>
            )}
          </>
        ) : undefined
      }
    >
      {loadError ? (
        notFound ? (
          <SettingsEmptyState variant='inline'>
            This person isn't in your organization.
          </SettingsEmptyState>
        ) : (
          <SettingsQueryErrorState
            error={loadError}
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
                    className='break-all text-[var(--text-body)] text-sm hover:underline'
                    href={serializePeopleView(routes.people, {
                      ...origin,
                      view: 'directory',
                      search: '',
                      panel: null,
                      department: data.person.departmentKey ? null : data.person.department,
                      departmentKey: data.person.departmentKey ?? null,
                    })}
                  >
                    {data.person.department}
                  </Link>
                ) : (
                  NOT_RECORDED
                )}
              </SettingsField>
              {data.person.directorySource && (
                <SettingsField label='Managed by'>
                  {SOURCE_NAMES[data.person.directorySource]}
                </SettingsField>
              )}
              <SettingsField label='Location'>{data.person.location ?? NOT_RECORDED}</SettingsField>
              <SettingsField label='Start date'>
                {data.person.startDate ? describeStartDate(data.person.startDate) : NOT_RECORDED}
              </SettingsField>
            </div>
          </DetailSection>
          <DetailSection title='Reports to'>
            <PersonRows
              organizationId={organizationId}
              originQuery={originQuery}
              people={data.chain}
              empty={data.person.managerMemberId ? 'Manager is suspended.' : 'No manager recorded.'}
            />
          </DetailSection>
          <DetailSection
            title={data.totalReports ? `Direct reports (${data.totalReports})` : 'Direct reports'}
          >
            <PersonRows
              organizationId={organizationId}
              originQuery={originQuery}
              people={data.reports}
              empty='No one reports to this person.'
            />
            {data.totalReports > data.reports.length && (
              <ChipLink href={chartHref}>Browse all {data.totalReports} reports</ChipLink>
            )}
          </DetailSection>
        </>
      )}
      {editing && data && !data.person.directorySource && (
        <PersonModal
          organizationId={organizationId}
          person={data.person}
          onClose={() => setEditing(false)}
        />
      )}
    </CredentialDetailLayout>
  )
}
