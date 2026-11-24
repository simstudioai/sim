import { Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'

interface UsageLimitReachedEmailProps {
  userName?: string
  planName: string
  /** Drives the remedy copy and CTA label — org admins raise the org limit. */
  scope: 'user' | 'organization'
  currentUsage: number
  limit: number
  ctaLink: string
  /** Set during a free trial, whose allowance is fixed until the trial ends on this date. */
  trialEndsOn?: string
}

const PAUSED_PRODUCTS = 'Workflow runs, knowledge base search, document uploads, and Chat'

/** The email's wording: a trial waits for its end date, other plans raise the limit. */
function getLimitReachedCopy(
  planName: string,
  scope: 'user' | 'organization',
  trialEndsOn: string | undefined
): { preview: string; status: string; remedy?: string; action: string } {
  if (trialEndsOn) {
    return {
      preview: `Sim: You've used your ${planName} trial credits`,
      status: `You've used the credits included in your ${planName} free trial. ${PAUSED_PRODUCTS} are paused until your trial ends on ${trialEndsOn}, when your full ${planName} allowance starts.`,
      action: 'View Billing',
    }
  }
  if (scope === 'organization') {
    return {
      preview: `Sim: You've reached your ${planName} usage limit`,
      status: `Your organization has reached its monthly usage limit on the ${planName} plan. ${PAUSED_PRODUCTS} are paused until the limit goes up.`,
      remedy: 'Raise the organization usage limit in billing settings to resume.',
      action: 'Raise Organization Limit',
    }
  }
  return {
    preview: `Sim: You've reached your ${planName} usage limit`,
    status: `You've reached your monthly usage limit on the ${planName} plan. ${PAUSED_PRODUCTS} are paused until the limit goes up.`,
    remedy: 'Raise your usage limit in billing settings, or upgrade your plan, to resume.',
    action: 'Raise Usage Limit',
  }
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
  trialEndsOn,
}: UsageLimitReachedEmailProps) {
  const copy = getLimitReachedCopy(planName, scope, trialEndsOn)

  return (
    <EmailLayout preview={copy.preview} showUnsubscribe={true}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>{copy.status}</Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Usage</Text>
        <Text style={baseStyles.infoBoxList}>
          {dollarsToCredits(currentUsage).toLocaleString()} of{' '}
          {dollarsToCredits(limit).toLocaleString()} credits used
        </Text>
      </Section>

      {copy.remedy && <Text style={baseStyles.paragraph}>{copy.remedy}</Text>}

      <EmailButton href={ctaLink}>{copy.action}</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Sent to the people who manage billing for this account.
      </Text>
    </EmailLayout>
  )
}

export default UsageLimitReachedEmail
