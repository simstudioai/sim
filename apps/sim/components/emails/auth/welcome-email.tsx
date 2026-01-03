import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface WelcomeEmailProps {
  userName?: string
}

export function WelcomeEmail({ userName }: WelcomeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <EmailLayout preview={`Welcome to ${brand.name}`}>
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
        {userName ? `Hey ${userName},` : 'Hey,'}
      </Text>
      <Text style={baseStyles.paragraph}>
        Welcome to {brand.name}! Your account is ready. Start building, testing, and deploying AI
        workflows in minutes.
      </Text>

      <Link href={`${baseUrl}/w`} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Get Started</Text>
      </Link>

      <Text style={baseStyles.paragraph}>
        If you have any questions or feedback, just reply to this email. I read every message!
      </Text>

      <Text style={baseStyles.paragraph}>- Emir, co-founder of {brand.name}</Text>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        You're on the free plan with $10 in credits to get started.
      </Text>
    </EmailLayout>
  )
}

export default WelcomeEmail
