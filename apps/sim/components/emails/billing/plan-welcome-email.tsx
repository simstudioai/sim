import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface PlanWelcomeEmailProps {
  planName: string
  userName?: string
  loginLink?: string
  trial?: {
    /** When the trial ends and the card is first charged, already formatted for display. */
    endsOn: string
    /** Credits the trial includes, already formatted for display. */
    credits: string
  }
}

export function PlanWelcomeEmail({ planName, userName, loginLink, trial }: PlanWelcomeEmailProps) {
  const baseUrl = getBaseUrl()
  const cta = loginLink || `${baseUrl}/login`

  const previewText = trial
    ? `Sim: Your ${planName} free trial has started`
    : `Sim: Your ${planName} plan is active`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>
      <Text style={baseStyles.paragraph}>
        Welcome to <EmailStrong>{planName}</EmailStrong>! You're all set to build, test, and scale
        your workflows.
      </Text>

      {trial && (
        <Text style={baseStyles.paragraph}>
          Your free trial includes <EmailStrong>{trial.credits} credits</EmailStrong> and runs until{' '}
          <EmailStrong>{trial.endsOn}</EmailStrong>. Your card is charged for {planName} when the
          trial ends unless you cancel before then in Settings → Subscription.
        </Text>
      )}

      <EmailButton href={cta}>Open Sim</EmailButton>

      <Text style={baseStyles.paragraph}>
        Want help getting started?{' '}
        <Link href={`${baseUrl}/team`} style={baseStyles.link}>
          Schedule a call
        </Link>{' '}
        with our team.
      </Text>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>Manage your subscription in Settings → Subscription.</Text>
    </EmailLayout>
  )
}

export default PlanWelcomeEmail
