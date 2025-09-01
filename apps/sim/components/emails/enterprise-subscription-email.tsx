import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { getAssetUrl } from '@/lib/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

interface EnterpriseSubscriptionEmailProps {
  userName?: string
  userEmail?: string
  loginLink?: string
  createdDate?: Date
}

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'

export const EnterpriseSubscriptionEmail = ({
  userName = 'Valued User',
  userEmail = '',
  loginLink = `${baseUrl}/login`,
  createdDate = new Date(),
}: EnterpriseSubscriptionEmailProps) => {
  const brand = getBrandConfig()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your Enterprise Plan is now active on Sim</Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={brand.logoUrl || getAssetUrl('static/sim.png')}
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
            <Text style={baseStyles.paragraph}>Hello {userName},</Text>
            <Text style={baseStyles.paragraph}>
              Great news! Your <strong>Enterprise Plan</strong> has been activated on Sim. You now
              have access to advanced features and increased capacity for your workflows.
            </Text>

            <Text style={baseStyles.paragraph}>
              Your account has been set up with full access to your organization. Click below to log
              in and start exploring your new Enterprise features:
            </Text>

            <Link href={loginLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Access Your Enterprise Account</Text>
            </Link>

            <Text style={baseStyles.paragraph}>
              <strong>What's next?</strong>
            </Text>
            <Text style={baseStyles.paragraph}>
              • Invite team members to your organization
              <br />• Begin building your workflows
            </Text>

            <Text style={baseStyles.paragraph}>
              If you have any questions or need assistance getting started, our support team is here
              to help.
            </Text>

            <Text style={baseStyles.paragraph}>
              Welcome to Sim Enterprise!
              <br />
              The Sim Team
            </Text>

            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '40px',
                textAlign: 'left',
                color: '#666666',
              }}
            >
              This email was sent on {format(createdDate, 'MMMM do, yyyy')} to {userEmail}
              regarding your Enterprise plan activation on Sim.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default EnterpriseSubscriptionEmail
