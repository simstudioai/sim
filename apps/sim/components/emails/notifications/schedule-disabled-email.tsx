import { Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import {
  SCHEDULE_DISABLE_REASON_COPY,
  type ScheduleDisableReason,
} from '@/lib/workflows/schedules/disable-reasons'
import { getBrandConfig } from '@/ee/whitelabeling'

interface ScheduleDisabledEmailProps {
  recipientName?: string
  /** Workflow name. Absent when the source row could not be read. */
  resourceName?: string
  reason: ScheduleDisableReason
  /** Consecutive failures at disable time. Rendered only for `consecutive_failures`. */
  failedCount?: number
  /** Deep link to the workflow. Absent when the workspace is unknown. */
  manageLink?: string
}

/**
 * Sent when Sim turns a schedule off on its own — either after repeated
 * failures or on a terminal error that cannot resolve itself.
 */
export function ScheduleDisabledEmail({
  recipientName,
  resourceName,
  reason,
  failedCount,
  manageLink,
}: ScheduleDisabledEmailProps) {
  const brand = getBrandConfig()
  const resourceLabel = resourceName ?? 'a scheduled workflow'
  const reasonCopy =
    reason === 'consecutive_failures' && failedCount
      ? `It failed ${failedCount.toLocaleString()} times in a row.`
      : SCHEDULE_DISABLE_REASON_COPY[reason]
  const previewText = `${brand.name} turned off the schedule for ${resourceLabel}`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={baseStyles.greeting}>{recipientName ? `Hi ${recipientName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        {brand.name} turned off the schedule for {resourceLabel}. It will not run again until you
        fix the problem and turn it back on.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Reason</Text>
        <Text style={baseStyles.infoBoxList}>{reasonCopy}</Text>
      </Section>

      {manageLink ? <EmailButton href={manageLink}>Open workflow</EmailButton> : null}

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Sent to workspace admins and the person who created this schedule.
      </Text>
    </EmailLayout>
  )
}

export default ScheduleDisabledEmail
