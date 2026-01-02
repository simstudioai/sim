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

interface WelcomeEmailProps {
  userName?: string
}

export function WelcomeEmail({ userName }: WelcomeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Preview>Welcome to {brand.name}</Preview>
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
              {userName ? `Hey ${userName},` : 'Hey,'}
            </Text>
            <Text style={baseStyles.paragraph}>
              Welcome to {brand.name}! Your account is ready. Start building, testing, and deploying
              AI workflows in minutes.
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
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default WelcomeEmail
