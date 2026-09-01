import { Section, Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getBrandConfig } from '@/ee/whitelabeling'

interface UsageLimitReachedEmailProps {
  userName?: string
  planName: string
  /** Drives the remedy copy and CTA label — org admins raise the org limit. */
  scope: 'user' | 'organization'
  currentUsage: number
  limit: number
  ctaLink: string
}

/**
 * Sent at 100% of the usage limit to paid and organization accounts. The
 * free-tier equivalent is `CreditsExhaustedEmail`, whose remedy is an upgrade
 * rather than a limit change.
 */
export function UsageLimitReachedEmail({
  userName,
  planName,
  scope,
  currentUsage,
  limit,
  ctaLink,
}: UsageLimitReachedEmailProps) {
  const brand = getBrandConfig()
  const isOrganization = scope === 'organization'
  const previewText = `${brand.name}: You've reached your ${planName} usage limit`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        {isOrganization
          ? `Your organization has reached its monthly usage limit on the ${planName} plan.`
          : `You've reached your monthly usage limit on the ${planName} plan.`}{' '}
        Workflow runs, knowledge base search, document uploads, and Chat are paused until the limit
        goes up.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Usage</Text>
        <Text style={baseStyles.infoBoxList}>
          {dollarsToCredits(currentUsage).toLocaleString()} of{' '}
          {dollarsToCredits(limit).toLocaleString()} credits used
        </Text>
      </Section>

      <Text style={baseStyles.paragraph}>
        {isOrganization
          ? 'Raise the organization usage limit in billing settings to resume.'
          : 'Raise your usage limit in billing settings, or upgrade your plan, to resume.'}
      </Text>

      <EmailButton href={ctaLink}>
        {isOrganization ? 'Raise Organization Limit' : 'Raise Usage Limit'}
      </EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Sent to the people who manage billing for this account.
      </Text>
    </EmailLayout>
  )
}

export default UsageLimitReachedEmail
