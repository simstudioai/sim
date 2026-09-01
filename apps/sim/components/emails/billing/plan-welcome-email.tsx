import { Link, Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface PlanWelcomeEmailProps {
  planName: string
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
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>
      <Text style={baseStyles.paragraph}>
        Welcome to <EmailStrong>{planName}</EmailStrong>! You're all set to build, test, and scale
        your workflows.
      </Text>

      <EmailButton href={cta}>Open {brand.name}</EmailButton>

      <Text style={baseStyles.paragraph}>
        Want help getting started?{' '}
        <Link href={`${baseUrl}/team`} style={baseStyles.link}>
          Schedule a call
        </Link>{' '}
        with our team.
      </Text>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>Manage your subscription in Settings → Subscription.</Text>
    </EmailLayout>
  )
}

export default PlanWelcomeEmail
