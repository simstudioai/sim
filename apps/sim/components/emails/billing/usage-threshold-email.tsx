import { Section, Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getBrandConfig } from '@/ee/whitelabeling'

interface UsageThresholdEmailProps {
  userName?: string
  planName: string
  percentUsed: number
  currentUsage: number
  limit: number
  ctaLink: string
}

export function UsageThresholdEmail({
  userName,
  planName,
  percentUsed,
  currentUsage,
  limit,
  ctaLink,
}: UsageThresholdEmailProps) {
  const brand = getBrandConfig()

  const previewText = `${brand.name}: You're at ${percentUsed}% of your ${planName} monthly budget`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        You're approaching your monthly budget on the {planName} plan.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Usage</Text>
        <Text style={baseStyles.infoBoxList}>
          {dollarsToCredits(currentUsage).toLocaleString()} of{' '}
          {dollarsToCredits(limit).toLocaleString()} credits used ({percentUsed}%)
        </Text>
      </Section>

      <Text style={baseStyles.paragraph}>
        To avoid interruptions, consider increasing your monthly limit.
      </Text>

      <EmailButton href={ctaLink}>Review Limits</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>One-time notification at 80% usage.</Text>
    </EmailLayout>
  )
}

export default UsageThresholdEmail
