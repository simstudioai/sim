import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'

interface TrialEndingEmailProps {
  planName: string
  userName?: string
  /** When the trial converts, already formatted for display. */
  endsOn: string
  /** What the card is charged when the trial converts, already formatted (e.g. `$25/month`). */
  price: string
  billingLink: string
}

/** Sent a few days before a free trial converts, so the charge is never a surprise. */
export function TrialEndingEmail({
  planName,
  userName,
  endsOn,
  price,
  billingLink,
}: TrialEndingEmailProps) {
  return (
    <EmailLayout
      preview={`Sim: Your ${planName} free trial ends ${endsOn}`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        Your <EmailStrong>{planName}</EmailStrong> free trial ends on{' '}
        <EmailStrong>{endsOn}</EmailStrong>. Your card will then be charged{' '}
        <EmailStrong>{price}</EmailStrong>, and the plan's full credits replace the trial allowance.
      </Text>

      <Text style={baseStyles.paragraph}>
        Nothing to do if you want to keep {planName}. To stop before the charge, cancel in Settings
        → Subscription before {endsOn}.
      </Text>

      <EmailButton href={billingLink}>Manage subscription</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>Sent once, a few days before your trial ends.</Text>
    </EmailLayout>
  )
}

export default TrialEndingEmail
