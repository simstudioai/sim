import { Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'

interface UsageThresholdEmailProps {
  userName?: string
  planName: string
  percentUsed: number
  currentUsage: number
  limit: number
  ctaLink: string
  /** Set during a free trial, whose allowance is fixed until the trial ends on this date. */
  trialEndsOn?: string
}

export function UsageThresholdEmail({
  userName,
  planName,
  percentUsed,
  currentUsage,
  limit,
  ctaLink,
  trialEndsOn,
}: UsageThresholdEmailProps) {
  const copy = trialEndsOn
    ? {
        preview: `Sim: You're at ${percentUsed}% of your ${planName} trial credits`,
        status: `You're approaching the credits included in your ${planName} free trial.`,
        remedy: `Your full ${planName} allowance starts when your trial ends on ${trialEndsOn}.`,
        action: 'View Billing',
      }
    : {
        preview: `Sim: You're at ${percentUsed}% of your ${planName} monthly budget`,
        status: `You're approaching your monthly budget on the ${planName} plan.`,
        remedy: 'To avoid interruptions, consider increasing your monthly limit.',
        action: 'Review Limits',
      }

  return (
    <EmailLayout preview={copy.preview} showUnsubscribe={true}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>{copy.status}</Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Usage</Text>
        <Text style={baseStyles.infoBoxList}>
          {dollarsToCredits(currentUsage).toLocaleString()} of{' '}
          {dollarsToCredits(limit).toLocaleString()} credits used ({percentUsed}%)
        </Text>
      </Section>

      <Text style={baseStyles.paragraph}>{copy.remedy}</Text>

      <EmailButton href={ctaLink}>{copy.action}</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>One-time notification at 80% usage.</Text>
    </EmailLayout>
  )
}

export default UsageThresholdEmail
