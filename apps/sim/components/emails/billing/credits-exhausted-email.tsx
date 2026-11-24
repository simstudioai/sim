import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { ProFeaturesBox } from '@/components/emails/billing/pro-features-box'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'

interface CreditsExhaustedEmailProps {
  userName?: string
  limit: number
  upgradeLink: string
}

export function CreditsExhaustedEmail({
  userName,
  limit,
  upgradeLink,
}: CreditsExhaustedEmailProps) {
  return (
    <EmailLayout
      preview={`You've used all ${dollarsToCredits(limit).toLocaleString()} of your free Sim credits`}
      showUnsubscribe={true}
    >
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        You&apos;ve used all <EmailStrong>{dollarsToCredits(limit).toLocaleString()}</EmailStrong>{' '}
        of your free credits on Sim. Your workflows are paused until you upgrade.
      </Text>

      <ProFeaturesBox />

      <EmailButton href={upgradeLink}>Upgrade to Pro</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        One-time notification when free credits are exhausted.
      </Text>
    </EmailLayout>
  )
}

export default CreditsExhaustedEmail
