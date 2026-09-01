import { Link, Section, Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

/** How a sub-processor's role on the list is changing. */
export type SubprocessorChangeType = 'added' | 'replaced' | 'removed'

const CHANGE_TYPE_LABEL: Record<SubprocessorChangeType, string> = {
  added: 'New sub-processor',
  replaced: 'Replacement sub-processor',
  removed: 'Sub-processor being removed',
}

/**
 * Dates in a notice period have to be unambiguous, so the month is spelled out
 * rather than left to the recipient's locale ordering of a numeric date. The
 * zone is pinned because the notice window is contractual — the rendered day
 * must not shift with the server the send happens to run on.
 */
const NOTICE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
}

function formatNoticeDate(date: Date): string {
  return date.toLocaleDateString('en-US', NOTICE_DATE_FORMAT)
}

export interface SubprocessorChange {
  /** Legal entity name of the sub-processor. */
  name: string
  /** What it is used for, in plain language. */
  purpose: string
  /** Categories of customer personal data it will process. */
  dataCategories: string
  /** Primary processing location, e.g. `United States`. */
  location: string
  changeType: SubprocessorChangeType
}

interface SubprocessorChangeEmailProps {
  recipientName?: string
  /** The sub-processors being added, replaced, or removed in this notice. */
  changes: SubprocessorChange[]
  /** When the change takes effect. Sent at least 30 days ahead of this date. */
  effectiveDate: Date
  /** Last day an objection can be raised. Falls on or before {@link effectiveDate}. */
  objectionDeadline: Date
  /** Where an objection is sent. */
  objectionEmail: string
  /** The public sub-processor list, which reflects the change once it is live. */
  subprocessorListUrl: string
  /** Where the recipient manages whether they receive these notices. */
  subscriptionUrl?: string
}

/**
 * Advance notice to subscribed customers that the sub-processors handling their
 * personal data are changing, with the window and address for objecting.
 */
export function SubprocessorChangeEmail({
  recipientName,
  changes,
  effectiveDate,
  objectionDeadline,
  objectionEmail,
  subprocessorListUrl,
  subscriptionUrl,
}: SubprocessorChangeEmailProps) {
  const brand = getBrandConfig()
  const effectiveDateLabel = formatNoticeDate(effectiveDate)
  const previewText = `${brand.name} is changing its sub-processors on ${effectiveDateLabel}`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>{recipientName ? `Hi ${recipientName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        We are giving you advance notice of a change to the sub-processors {brand.name} uses to
        process customer personal data. The change takes effect on{' '}
        <EmailStrong>{effectiveDateLabel}</EmailStrong>.
      </Text>

      {changes.map((change) => (
        <Section key={change.name} style={baseStyles.infoBox}>
          <Text style={baseStyles.infoBoxTitle}>
            {change.name} — {CHANGE_TYPE_LABEL[change.changeType]}
          </Text>
          <Text style={baseStyles.infoBoxList}>
            Purpose: {change.purpose}
            <br />
            Data processed: {change.dataCategories}
            <br />
            Processing location: {change.location}
            <br />
            Effective: {effectiveDateLabel}
          </Text>
        </Section>
      ))}

      <Text style={baseStyles.paragraph}>
        If you object to this change, reply to this email or write to{' '}
        <Link href={`mailto:${objectionEmail}`} style={baseStyles.link}>
          {objectionEmail}
        </Link>{' '}
        by <EmailStrong>{formatNoticeDate(objectionDeadline)}</EmailStrong>. We will work with you
        on a resolution, and you may terminate the affected service if we cannot reach one.
      </Text>

      <Text style={baseStyles.paragraph}>
        No action is needed if you have no objection. The full list of sub-processors stays current
        at the link below.
      </Text>

      <EmailButton href={subprocessorListUrl}>View sub-processor list</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Sent to customers subscribed to sub-processor change notices.
        {subscriptionUrl ? (
          <>
            {' '}
            <Link href={subscriptionUrl} style={baseStyles.footerLink}>
              Manage whether you receive them
            </Link>
            .
          </>
        ) : null}
      </Text>
    </EmailLayout>
  )
}

export default SubprocessorChangeEmail
