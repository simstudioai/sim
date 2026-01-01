import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

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
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        {/* Main card container */}
        <Container style={baseStyles.container}>
          {/* Header with logo */}
          <Section style={baseStyles.header}>
            <Img
              src={brand.logoUrl || `${baseUrl}/brand/color/email/type.png`}
              width='70'
              alt={brand.name}
              style={{ display: 'block' }}
            />
          </Section>

          {/* Content */}
          <Section style={baseStyles.content}>
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
              <Link href='https://cal.com/waleedlatif/15min' style={baseStyles.link}>
                Schedule a call
              </Link>{' '}
              with our team.
            </Text>

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
              Manage your subscription in Settings → Subscription.
            </Text>
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default PlanWelcomeEmail
