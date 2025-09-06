import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { getAssetUrl } from '@/lib/utils'

interface PlanWelcomeEmailProps {
  planName: 'Pro' | 'Team'
  userName?: string
  loginLink?: string
  createdDate?: Date
}

export function PlanWelcomeEmail({
  planName,
  userName,
  loginLink,
  createdDate = new Date(),
}: PlanWelcomeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
  const cta = loginLink || `${baseUrl}/login`

  const previewText = `${brand.name}: Your ${planName} plan is active`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        <Container style={baseStyles.container}>
          <Section style={baseStyles.header}>
            <Img
              src={getAssetUrl('logo-sim.svg')}
              alt={`${brand.name} Logo`}
              width='80'
              height='80'
            />
          </Section>

          <Section style={baseStyles.content}>
            <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
              {userName ? `Hi ${userName},` : 'Hi,'}
            </Text>
            <Text style={baseStyles.paragraph}>
              Welcome to the <strong>{planName}</strong> plan on {brand.name}. You're all set to
              build, test, and scale your agentic workflows.
            </Text>

            <Button style={baseStyles.button} href={cta} rel='noopener noreferrer'>
              Open {brand.name}
            </Button>

            <Hr />

            <Text style={baseStyles.paragraph}>
              Need to invite teammates, adjust usage limits, or manage billing? You can do that from
              Settings → Subscription.
            </Text>

            <Text style={{ ...baseStyles.paragraph, fontSize: '12px', color: '#666' }}>
              Sent on {createdDate.toLocaleDateString()}
            </Text>
          </Section>
        </Container>
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default PlanWelcomeEmail
