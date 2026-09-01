import { Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { ProFeaturesBox } from '@/components/emails/billing/pro-features-box'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getBrandConfig } from '@/ee/whitelabeling'

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
  const brand = getBrandConfig()

  return (
    <EmailLayout
      preview={`You've used all ${dollarsToCredits(limit).toLocaleString()} of your free ${brand.name} credits`}
      showUnsubscribe={true}
    >
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        You&apos;ve used all <EmailStrong>{dollarsToCredits(limit).toLocaleString()}</EmailStrong>{' '}
        of your free credits on {brand.name}. Your workflows are paused until you upgrade.
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
