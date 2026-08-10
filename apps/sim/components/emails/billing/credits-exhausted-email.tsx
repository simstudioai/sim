import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { ProFeaturesBox } from '@/components/emails/billing/pro-features-box'
import { EmailLayout } from '@/components/emails/components'
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
        You&apos;ve used all <strong>{dollarsToCredits(limit).toLocaleString()}</strong> of your
        free credits on {brand.name}. Your workflows are paused until you upgrade.
      </Text>

      <ProFeaturesBox />

      <Link href={upgradeLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Upgrade to Pro</Text>
      </Link>

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        One-time notification when free credits are exhausted.
      </Text>
    </EmailLayout>
  )
}

export default CreditsExhaustedEmail
