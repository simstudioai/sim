import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { baseStyles } from './base-styles'

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
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={brand.logoUrl || '/logo/reverse/text/medium.png'}
                  width='114'
                  alt={brand.name}
                  style={{
                    margin: '0 auto',
                  }}
                />
              </Column>
            </Row>
          </Section>

          <Section style={baseStyles.sectionsBorders}>
            <Row>
              <Column style={baseStyles.sectionBorder} />
              <Column style={baseStyles.sectionCenter} />
              <Column style={baseStyles.sectionBorder} />
            </Row>
          </Section>

          <Section style={baseStyles.content}>
            <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
              {userName ? `Hi ${userName},` : 'Hi,'}
            </Text>
            <Text style={baseStyles.paragraph}>
              Welcome to the <strong>{planName}</strong> plan on {brand.name}. You're all set to
              build, test, and scale your agentic workflows.
            </Text>

            <Link href={cta} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Open {brand.name}</Text>
            </Link>

            <Text style={baseStyles.paragraph}>
              Want to discuss your plan or get personalized help getting started?{' '}
              <Link href='https://cal.com/waleedlatif/15min' style={baseStyles.link}>
                Schedule a 15-minute call
              </Link>{' '}
              with our team.
            </Text>

            <Hr />

            <Text style={baseStyles.paragraph}>
              Need to invite teammates, adjust usage limits, or manage billing? You can do that from
              Settings → Subscription.
            </Text>

            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Team
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
