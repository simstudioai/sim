import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/settings/_components/sections/members/members.module.css'
import { Button, InlineNotice, StatusTag } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { useMembers } from '@/platform/lib/data/members'

interface SeatsOverviewProps {
  seats: ReturnType<typeof useMembers>['seats']
}

export function SeatsOverview({ seats }: SeatsOverviewProps) {
  if (seats.status === 'pending') return null
  if (seats.status === 'error')
    return (
      <InlineNotice
        intent='danger'
        title='Failed to load seat information'
        message={getErrorMessage(seats.error, 'Seat information is unavailable.')}
        action={
          <Button size='compact' disabled={seats.retrying} onClick={seats.retry}>
            Retry
          </Button>
        }
      />
    )
  const { model } = seats
  if (!model) return null
  if (model.kind === 'none')
    return (
      <SettingsSection title='Seats'>
        <SettingsRow
          label='No active Team subscription'
          description='Purchase a Team plan to invite teammates to this organization.'
        >
          <Button render={<Link href='/settings/billing' />} variant='primary' size='compact'>
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
        <SettingsRow label={`${model.used} ${model.used === 1 ? 'seat' : 'seats'}`}>
          {tags}
        </SettingsRow>
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
