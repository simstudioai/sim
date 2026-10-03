import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { ProFeaturesBox } from '@/components/emails/billing/pro-features-box'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getBrandConfig } from '@/ee/whitelabeling'

interface FreeTierUpgradeEmailProps {
  userName?: string
  percentUsed: number
  currentUsage: number
  limit: number
  upgradeLink: string
}

export function FreeTierUpgradeEmail({
  userName,
  percentUsed,
  currentUsage,
  limit,
  upgradeLink,
}: FreeTierUpgradeEmailProps) {
  const brand = getBrandConfig()

  const previewText = `${brand.name}: You've used ${percentUsed}% of your free credits`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        You've used <EmailStrong>{dollarsToCredits(currentUsage).toLocaleString()}</EmailStrong> of
        your <EmailStrong>{dollarsToCredits(limit).toLocaleString()}</EmailStrong> free credits (
        {percentUsed}%). Upgrade to Pro to keep building without interruption.
      </Text>

      <ProFeaturesBox />

      <EmailButton href={upgradeLink}>Upgrade to Pro</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>One-time notification at 80% usage.</Text>
    </EmailLayout>
  )
}

export default FreeTierUpgradeEmail
