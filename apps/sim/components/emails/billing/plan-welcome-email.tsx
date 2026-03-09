import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface PlanWelcomeEmailProps {
  planName: 'Pro' | 'Team'
  userName?: string
  loginLink?: string
}

export function PlanWelcomeEmail({ planName, userName, loginLink }: PlanWelcomeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const cta = loginLink || `${baseUrl}/login`

  const previewText = `${brand.name}: Your ${planName} plan is active`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
        {userName ? `Hi ${userName},` : 'Hi,'}
      </Text>
      <Text style={baseStyles.paragraph}>
        Welcome to <strong>{planName}</strong>! You're all set to build, test, and scale your
        workflows.
      </Text>

      <Link href={cta} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Open {brand.name}</Text>
      </Link>

      <Text style={baseStyles.paragraph}>
        Want help getting started?{' '}
        <Link href={`${baseUrl}/team`} style={baseStyles.link}>
          Schedule a call
        </Link>{' '}
        with our team.
      </Text>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Manage your subscription in Settings → Subscription.
      </Text>
    </EmailLayout>
  )
}

export default PlanWelcomeEmail
