'use client'

import { useState } from 'react'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/people/_components/person/person.module.css'
import { PersonModal } from '@/platform/app/(shell)/people/_components/person/person-modal'
import {
  ActivityRow,
  Avatar,
  Button,
  EmptyState,
  FailureNotice,
  InlineNotice,
  PropertyList,
} from '@/platform/design-system/components'
import type { PropertyItem } from '@/platform/design-system/components/property-list/property-list'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  isGone,
  type Person,
  type PersonSummary,
  personHref,
  usePersonProfile,
} from '@/platform/lib/data/people'
import { formatCalendarDate } from '@/platform/lib/time'

const SOURCE_NAMES = {
  scim: 'SCIM provisioning',
  okta: 'Okta',
  entra: 'Microsoft Entra ID',
} as const
const NOT_RECORDED = 'Not recorded'

/** `2024-01-31` as a calendar day, with how long ago it was: "Jan 31, 2024 · 2 yrs". */
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
  return `${formatCalendarDate(startDate, 'full')} · ${tenure}`
}

interface PersonRowsProps {
  title: string
  people: readonly PersonSummary[]
  empty: string
  originQuery: string
}

function PersonRows({ title, people, empty, originQuery }: PersonRowsProps) {
  return (
    <section className={styles.rows} aria-label={title}>
      <h2 data-type='T042'>{title}</h2>
      {people.length === 0 ? (
        <p className={styles.secondary} data-type='T060'>
          {empty}
        </p>
      ) : (
        <ul className={styles.list}>
          {people.map((person) => (
            <ActivityRow
              key={person.memberId}
              leading={<Avatar name={person.name} src={person.image ?? undefined} />}
              title={person.name}
              detail={person.title ?? person.email}
              href={personHref(person.memberId, originQuery)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function details(person: Person, departmentHref: string): PropertyItem[] {
  return [
    {
      id: 'email',
      label: 'Email',
      kind: 'link',
      value: person.email,
      href: `mailto:${person.email}`,
    },
    person.department
      ? {
          id: 'department',
          label: 'Department',
          kind: 'link',
          value: person.department,
          href: departmentHref,
        }
      : { id: 'department', label: 'Department', kind: 'metadata', value: NOT_RECORDED },
    ...(person.directorySource
      ? [
          {
            id: 'source',
            label: 'Managed by',
            kind: 'text' as const,
            value: SOURCE_NAMES[person.directorySource],
          },
        ]
      : []),
    {
      id: 'location',
      label: 'Location',
      kind: person.location ? 'text' : 'metadata',
      value: person.location ?? NOT_RECORDED,
    },
    {
      id: 'start',
      label: 'Start date',
      kind: person.startDate ? 'text' : 'metadata',
      value: person.startDate ? describeStartDate(person.startDate) : NOT_RECORDED,
    },
  ]
}

interface PersonProfileProps {
  organization: PlatformOrganization
  memberId: string
}

export function PersonProfile({ organization, memberId }: PersonProfileProps) {
  const organizationId = organization.organization.id
  const profile = usePersonProfile(organizationId, memberId)
  const [editing, setEditing] = useState(false)
  const { data } = profile
  const canEdit = organization.viewer.isAdmin && Boolean(data) && !data?.person.directorySource
  return (
    <main className={styles.page}>
      <div className={styles.nav}>
        <Button variant='quiet' icon='I023' render={<Link href={profile.backHref} />}>
          People
        </Button>
        {data && (
          <span className={styles.actions}>
            <Button render={<Link href={profile.chartHref} />}>View in org chart</Button>
            {canEdit && <Button onClick={() => setEditing(true)}>Edit</Button>}
          </span>
        )}
      </div>
      {profile.error ? (
        isGone(profile.error) ? (
          <EmptyState title="This person isn't in your organization." />
        ) : (
          <FailureNotice
            title='Could not load this person'
            message={profile.error.message}
            retrying={profile.retrying}
            onRetry={profile.retry}
          />
        )
      ) : !data ? (
        <p className={styles.secondary} role='status' data-type='T060'>
          Loading…
        </p>
      ) : (
        <>
          <header className={styles.heading}>
            <Avatar name={data.person.name} src={data.person.image ?? undefined} />
            <div className={styles.titles}>
              <h1 data-type='T076'>{data.person.name}</h1>
              {data.person.title && (
                <p className={styles.secondary} data-type='T067'>
                  {data.person.title}
                </p>
              )}
            </div>
          </header>
          <PropertyList
            title='Details'
            properties={details(data.person, profile.departmentHref(data.person))}
          />
          <PersonRows
            title='Reports to'
            people={data.chain}
            empty={data.person.managerMemberId ? 'Manager is suspended.' : 'No manager recorded.'}
            originQuery={profile.originQuery}
          />
          <PersonRows
            title={data.totalReports ? `Direct reports (${data.totalReports})` : 'Direct reports'}
            people={data.reports}
            empty='No one reports to this person.'
            originQuery={profile.originQuery}
          />
          {data.totalReports > data.reports.length && (
            <div>
              <Button render={<Link href={profile.chartHref} />}>
                {`Browse all ${data.totalReports} reports`}
              </Button>
            </div>
          )}
          {editing && canEdit && (
            <PersonModal
              organizationId={organizationId}
              person={data.person}
              onClose={() => setEditing(false)}
            />
          )}
        </>
      )}
    </main>
  )
}
