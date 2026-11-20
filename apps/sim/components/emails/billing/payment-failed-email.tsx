import { Link, Section, Text } from '@react-email/components'
import { baseStyles, colors, fontWeight } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import { getEmailSubject } from '@/components/emails/subjects'
import { SUPPORT_EMAIL } from '@/lib/branding/contact'

interface PaymentFailedEmailProps {
  userName?: string
  amountDue: number
  lastFourDigits?: string
  billingPortalUrl: string
  failureReason?: string
}

export function PaymentFailedEmail({
  userName,
  amountDue,
  lastFourDigits,
  billingPortalUrl,
  failureReason,
}: PaymentFailedEmailProps) {
  const previewText = getEmailSubject('payment-failed')

  return (
    <EmailLayout preview={previewText} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text
        style={{
          ...baseStyles.paragraph,
          fontWeight: fontWeight.semibold,
          color: colors.textPrimary,
        }}
      >
        We were unable to process your payment.
      </Text>

      <Text style={baseStyles.paragraph}>
        Your Sim account has been temporarily blocked to prevent service interruptions and
        unexpected charges. To restore access immediately, please update your payment method.
      </Text>

      <Section style={baseStyles.errorBox}>
        <Text style={baseStyles.infoBoxTitle}>Payment Details</Text>
        <Text style={baseStyles.infoBoxList}>
          Amount due: ${amountDue.toFixed(2)}
          {lastFourDigits && (
            <>
              <br />
              Payment method: •••• {lastFourDigits}
            </>
          )}
          {failureReason && (
            <>
              <br />
              Reason: {failureReason}
            </>
          )}
        </Text>
      </Section>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>What happens next</Text>
        <Text style={baseStyles.infoBoxList}>
          • Your workflows and automations are currently paused
          <br />• Update your payment method to restore service immediately
          <br />• Stripe will automatically retry the charge once payment is updated
        </Text>
      </Section>

      <EmailButton href={billingPortalUrl}>Update Payment Method</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Common issues: expired card, insufficient funds, or incorrect billing info. Need help?{' '}
        <Link href={`mailto:${SUPPORT_EMAIL}`} style={baseStyles.link}>
          {SUPPORT_EMAIL}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export default PaymentFailedEmail
