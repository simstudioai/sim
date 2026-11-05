import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { LoadingState } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/app/(shell)/settings/_components/sections/members/members.module.css'
import { Button, FailureNotice, StatusTag } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { useMembers } from '@/platform/lib/data/members'
import { useOrganization } from '@/platform/lib/data/organization'
import { plural } from '@/platform/lib/plural'

interface SeatsOverviewProps {
  seats: ReturnType<typeof useMembers>['seats']
}

export function SeatsOverview({ seats }: SeatsOverviewProps) {
  const organizationId = useOrganization().organization.id
  if (seats.status === 'pending') return <LoadingState label='Loading seats' rows={1} />
  if (seats.status === 'error')
    return (
      <FailureNotice
        title='Failed to load seat information'
        message={getErrorMessage(seats.error, 'Seat information is unavailable.')}
        retrying={seats.retrying}
        onRetry={seats.retry}
      />
    )
  const { model } = seats
  const billingHref = getOrganizationSettingsHref(organizationId, 'billing')
  if (!model) return null
  if (model.kind === 'none')
    return (
      <SettingsSection title='Seats'>
        <SettingsRow
          label='No active Team subscription'
          description='Purchase a Team plan to invite teammates to this organization.'
        >
          <Button render={<Link href={billingHref} />} variant='primary' size='compact'>
            View plans
          </Button>
        </SettingsRow>
      </SettingsSection>
    )
  const tags = (
    <span className={styles.controls}>
      {model.pending > 0 && <StatusTag label={`${model.pending} pending`} />}
      {model.overLimit && model.kind === 'enterprise' && (
        <StatusTag label='Over limit' intent='warning' />
      )}
    </span>
  )
  if (model.kind === 'team')
    return (
      <SettingsSection title='Seats'>
        <SettingsRow label={plural(model.used, 'seat')}>{tags}</SettingsRow>
      </SettingsSection>
    )
  return (
    <SettingsSection title='Seats'>
      <SettingsRow
        label={`${model.used} used / ${model.total} total`}
        description={
          model.overLimit
            ? 'You have more teammates than seats. Contact support to adjust your enterprise seat count.'
            : 'Contact support for enterprise seat changes.'
        }
      >
        {tags}
      </SettingsRow>
      <svg
        className={styles.meter}
        role='img'
        aria-label={`${model.used} of ${model.total} seats used`}
      >
        <rect className={styles.meterTrack} width='100%' height='100%' />
        <rect
          className={styles.meterFill}
          data-over={model.overLimit || undefined}
          width={`${Math.min(100, model.total ? (model.used / model.total) * 100 : 0)}%`}
          height='100%'
        />
      </svg>
    </SettingsSection>
  )
}
