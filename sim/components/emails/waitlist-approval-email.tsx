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
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

interface WaitlistApprovalEmailProps {
  email?: string
  signupLink?: string
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'

export const WaitlistApprovalEmail = ({
  email = '',
  signupLink = '',
}: WaitlistApprovalEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>You've Been Approved to Join Sim Studio!</Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={`${baseUrl}/static/sim.png`}
                  width="114"
                  alt="Sim Studio"
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
            <Text style={baseStyles.paragraph}>Great news!</Text>
            <Text style={baseStyles.paragraph}>
              You've been approved to join Sim Studio! We're excited to have you as part of our
              community of developers building, testing, and optimizing AI workflows.
            </Text>
            <Text style={baseStyles.paragraph}>
              Your email ({email}) has been approved. Click the button below to create your account
              and start using Sim Studio today:
            </Text>
            <Link href={signupLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Create Your Account</Text>
            </Link>
            <Text style={baseStyles.paragraph}>
              This approval link will expire in 7 days. If you have any questions or need
              assistance, feel free to reach out to our support team.
            </Text>
            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Studio Team
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default WaitlistApprovalEmail
