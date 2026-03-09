import { Link, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
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
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
        {userName ? `Hi ${userName},` : 'Hi,'}
      </Text>

      <Text style={baseStyles.paragraph}>
        You're approaching your monthly budget on the {planName} plan.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Usage</Text>
        <Text style={baseStyles.infoBoxList}>
          ${currentUsage.toFixed(2)} of ${limit.toFixed(2)} used ({percentUsed}%)
        </Text>
      </Section>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={baseStyles.paragraph}>
        To avoid interruptions, consider increasing your monthly limit.
      </Text>

      <Link href={ctaLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Review Limits</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        One-time notification at 80% usage.
      </Text>
    </EmailLayout>
  )
}

export default UsageThresholdEmail
