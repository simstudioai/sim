'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import { ProfileUnavailable } from '@/platform/app/(shell)/people/_components/people-page/profile-unavailable'
import styles from '@/platform/app/(shell)/people/_components/person/person.module.css'
import { PersonModal } from '@/platform/app/(shell)/people/_components/person/person-modal'
import { PersonIdentity } from '@/platform/app/(shell)/people/_components/person-identity/person-identity'
import {
  Avatar,
  Button,
  FailureNotice,
  Icon,
  PageColumn,
} from '@/platform/design-system/components'
import { useClipboard } from '@/platform/design-system/components/feedback/use-clipboard'
import { publicAssetPath } from '@/platform/design-system/navigation'
import { usePeoplePath, usePeopleViewer, usePersonProfile } from '@/platform/lib/data/people'
import {
  type Person,
  type PersonSummary,
  personHref,
  SYNC_SOURCE_NAMES,
} from '@/platform/shared/people'
import { isRefusal } from '@/platform/shared/query-view'
import { formatCalendarDate } from '@/platform/shared/time'

const NOT_PROVIDED = 'Not provided'

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

interface AboutProps {
  person: Person
  departmentHref: string
}

function About({ person, departmentHref }: AboutProps) {
  const facts: { label: string; value: string; href?: string }[] = [
    { label: 'Email', value: person.email, href: `mailto:${person.email}` },
    {
      label: 'Department',
      value: person.department ?? NOT_PROVIDED,
      href: person.department ? departmentHref : undefined,
    },
    { label: 'Location', value: person.location ?? NOT_PROVIDED },
    {
      label: 'Start date',
      value: person.startDate ? describeStartDate(person.startDate) : NOT_PROVIDED,
    },
  ]
  return (
    <section className={styles.about} aria-labelledby='person-about'>
      <h2 id='person-about' data-type='T081'>
        About
      </h2>
      <dl className={styles.facts}>
        {facts.map(({ label, value, href }) => (
          <div key={label} className={styles.fact}>
            <dt className={styles.secondary} data-type='T050'>
              {label}
            </dt>
            <dd data-type='T043'>
              {href ? (
                <Link href={href} className={styles.factLink}>
                  {value}
                </Link>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {person.directorySource && (
        <div className={styles.managed}>
          <p className={styles.managedBy} data-type='T050'>
            <Icon name='I065' />
            Managed by {SYNC_SOURCE_NAMES[person.directorySource]}
          </p>
          <p className={styles.secondary} data-type='T050'>
            Profile details update from your directory. Contact an admin to make a correction.
          </p>
        </div>
      )}
    </section>
  )
}

interface PersonRowsProps {
  originQuery: string
  people: readonly PersonSummary[]
}

function PersonRows({ originQuery, people }: PersonRowsProps) {
  const peoplePath = usePeoplePath()
  return (
    <ul className={styles.list}>
      {people.map((person) => (
        <li key={person.memberId}>
          <Link
            href={personHref(peoplePath, person.memberId, originQuery)}
            className={styles.row}
            aria-label={`Open ${person.name}`}
          >
            <PersonIdentity person={person} />
            <Icon name='I032' />
          </Link>
        </li>
      ))}
    </ul>
  )
}

interface PersonProfileProps {
  organizationId: string
  memberId: string
}

export function PersonProfile({ organizationId, memberId }: PersonProfileProps) {
  const peoplePath = usePeoplePath()
  const { isAdmin } = usePeopleViewer()
  const profile = usePersonProfile(organizationId, memberId)
  const { copied, copy } = useClipboard()
  const [editing, setEditing] = useState(false)
  const { data } = profile
  const canEdit = isAdmin && Boolean(data) && !data?.person.directorySource
  const unavailable = isRefusal(profile.error)
  return (
    <PageColumn>
      <main className={styles.page}>
        <div className={styles.nav}>
          {!unavailable && (
            <div className={styles.back}>
              <Button variant='quiet' icon='I093' render={<Link href={profile.backHref} />}>
                {profile.originView === 'chart' ? 'Back to org chart' : 'Back to directory'}
              </Button>
            </div>
          )}
          {data && (
            <Button
              icon={copied ? 'I072' : 'I006'}
              onClick={() =>
                void copy(
                  `${window.location.origin}${publicAssetPath(personHref(peoplePath, memberId))}`
                )
              }
            >
              {copied ? 'Copied' : 'Copy profile link'}
            </Button>
          )}
        </div>
        {profile.error ? (
          unavailable ? (
            <ProfileUnavailable
              action={
                <Button render={<Link href={profile.directoryHref} />}>Back to directory</Button>
              }
            />
          ) : (
            <FailureNotice
              title='Could not load this person'
              message={profile.error.message}
              retrying={profile.retrying}
              onRetry={profile.retry}
            />
          )
        ) : !data ? (
          <PeopleStatus>Loading profile…</PeopleStatus>
        ) : (
          <>
            <header className={styles.heading}>
              <div className={styles.identity}>
                <Avatar name={data.person.name} src={data.person.image ?? undefined} size='hero' />
                <div className={styles.titles}>
                  <h1 data-type='T102'>{data.person.name}</h1>
                  {data.person.title && (
                    <p className={styles.secondary} data-type='T106'>
                      {data.person.title}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.actions}>
                <Button icon='I133' render={<Link href={profile.chartHref} />}>
                  View in org chart
                </Button>
                {canEdit && <Button onClick={() => setEditing(true)}>Edit</Button>}
              </div>
            </header>
            <div className={styles.columns}>
              <About person={data.person} departmentHref={profile.departmentHref} />
              <div className={styles.lines}>
                <section className={styles.lineSection} aria-labelledby='person-manager'>
                  <h2 id='person-manager' data-type='T081'>
                    Reports to
                  </h2>
                  {data.chain.length > 0 ? (
                    <PersonRows originQuery={profile.originQuery} people={data.chain.slice(0, 1)} />
                  ) : (
                    <p className={styles.secondary} data-type='T043'>
                      {data.person.managerMemberId
                        ? 'Their manager is suspended.'
                        : 'No manager listed. This person is still part of your organization, and their reporting line will appear when it is provided.'}
                    </p>
                  )}
                </section>
                <section className={styles.lineSection} aria-labelledby='person-reports'>
                  <div className={styles.lineHeading}>
                    <h2 id='person-reports' data-type='T081'>
                      Direct reports
                    </h2>
                    {data.totalReports > 0 && (
                      <span className={styles.secondary} data-type='T050'>
                        {data.totalReports === 1 ? '1 person' : `${data.totalReports} people`}
                      </span>
                    )}
                  </div>
                  {data.reports.length > 0 ? (
                    <PersonRows originQuery={profile.originQuery} people={data.reports} />
                  ) : (
                    <p className={styles.secondary} data-type='T043'>
                      No one reports to this person.
                    </p>
                  )}
                  {data.totalReports > data.reports.length && (
                    <div>
                      <Button render={<Link href={profile.chartHref} />}>
                        {`Browse all ${data.totalReports} reports`}
                      </Button>
                    </div>
                  )}
                </section>
              </div>
            </div>
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
    </PageColumn>
  )
}
