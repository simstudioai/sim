import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface WelcomeEmailProps {
  userName?: string
}

export function WelcomeEmail({ userName }: WelcomeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <EmailLayout preview={`Welcome to ${brand.name}`} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>{userName ? `Hey ${userName},` : 'Hey,'}</Text>
      <Text style={baseStyles.paragraph}>
        Welcome to {brand.name}! Your account is ready. Start building, testing, and deploying AI
        workflows in minutes.
      </Text>

      <EmailButton href={`${baseUrl}/login`}>Get Started</EmailButton>

      <Text style={baseStyles.paragraph}>
        If you have any questions or feedback, just reply to this email. I read every message!
      </Text>

      <Text style={baseStyles.paragraph}>
        Want to chat?{' '}
        <Link href={`${baseUrl}/team`} style={baseStyles.link}>
          Schedule a call
        </Link>{' '}
        with our team.
      </Text>

      <Text style={baseStyles.paragraph}>- Emir, co-founder of {brand.name}</Text>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        You're on the Community plan with 1,000 credits to get started.
      </Text>
    </EmailLayout>
  )
}

export default WelcomeEmail
