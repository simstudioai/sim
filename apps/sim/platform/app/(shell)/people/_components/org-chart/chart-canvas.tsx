import type { MouseEvent, ReactNode } from 'react'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/people/_components/org-chart/org-chart.module.css'
import { Avatar, Icon, IconButton, OverflowText } from '@/platform/design-system/components'
import { type ChartBranch, type PersonSummary, personHref } from '@/platform/lib/data/people'
import { plural } from '@/platform/lib/plural'

type ChartFocus = (memberId: string, event: MouseEvent<HTMLButtonElement>) => void

interface CardCopyProps {
  person: PersonSummary
  footer: string
  action: ReactNode
}

function CardCopy({ person, footer, action }: CardCopyProps) {
  return (
    <>
      <span className={styles.identity}>
        <Avatar name={person.name} src={person.image ?? undefined} />
        <span className={styles.names}>
          <span data-type='T059'>
            <OverflowText text={person.name}>{person.name}</OverflowText>
          </span>
          <span className={styles.secondary} data-type='T050'>
            <OverflowText text={person.title || person.email}>
              {person.title || person.email}
            </OverflowText>
          </span>
        </span>
      </span>
      <span className={styles.cardFooter} data-type='T050'>
        <OverflowText text={footer}>{footer}</OverflowText>
        <span className={styles.cardAction}>{action}</span>
      </span>
    </>
  )
}

interface ExploreCardProps {
  person: PersonSummary
  relation: 'Manager' | 'Direct report'
  reportCount?: number
  profileQuery: string
  onFocus: ChartFocus
}

function ExploreCard({ person, relation, reportCount, profileQuery, onFocus }: ExploreCardProps) {
  return (
    <div className={styles.card}>
      <button
        type='button'
        className={styles.cardTarget}
        aria-label={`Explore ${person.name}`}
        onClick={(event) => onFocus(person.memberId, event)}
      >
        <CardCopy
          person={person}
          footer={relation}
          action={
            <>
              {reportCount === undefined ? 'Explore team' : plural(reportCount, 'report')}
              <Icon name='I032' />
            </>
          }
        />
      </button>
      <span className={styles.profileLink}>
        <IconButton
          tooltip
          render={<Link href={personHref(person.memberId, profileQuery)} prefetch={false} />}
          label={`Open ${person.name}’s profile`}
          icon='I037'
        />
      </span>
    </div>
  )
}

interface ChartCanvasProps {
  branch: ChartBranch
  profileQuery: string
  onFocus: ChartFocus
}

/**
 * The fixed layout: at most one manager, the person in focus, and a page of up to four reports,
 * joined by the rules the CSS draws. There is no arbitrary graph to pan around, and real tab order
 * replaces a canvas focus model.
 */
export function ChartCanvas({ branch, profileQuery, onFocus }: ChartCanvasProps) {
  const { person, chain, reports } = branch
  const [manager] = chain
  return (
    <div className={styles.canvas} role='group' aria-label='Organization chart'>
      {manager && (
        <div className={styles.level} data-connects-below>
          <ExploreCard
            person={manager}
            relation='Manager'
            profileQuery={profileQuery}
            onFocus={onFocus}
          />
        </div>
      )}
      <div
        className={styles.level}
        data-connects-above={manager ? true : undefined}
        data-connects-below={reports.length ? true : undefined}
      >
        <div className={styles.card} data-focus-card>
          <Link
            href={personHref(person.memberId, profileQuery)}
            className={styles.cardTarget}
            aria-label={`View profile for ${person.name}`}
          >
            <CardCopy
              person={person}
              footer={person.department || 'In focus'}
              action={
                <>
                  View profile
                  <Icon name='I037' />
                </>
              }
            />
          </Link>
        </div>
      </div>
      {reports.length > 0 && (
        <ul className={styles.reports} data-single={reports.length === 1 || undefined}>
          {reports.map((report) => (
            <li key={report.memberId} className={styles.report}>
              <ExploreCard
                person={report}
                relation='Direct report'
                reportCount={report.reportCount}
                profileQuery={profileQuery}
                onFocus={onFocus}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
