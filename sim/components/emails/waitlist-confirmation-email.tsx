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

interface WaitlistConfirmationEmailProps {
  email?: string
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
const calendlyLink = 'https://calendly.com/emir-simstudio/15min'

export const WaitlistConfirmationEmail = ({ email = '' }: WaitlistConfirmationEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Welcome to the Sim Studio Waitlist!</Preview>
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
            <Text style={baseStyles.paragraph}>Welcome to the Sim Studio Waitlist!</Text>
            <Text style={baseStyles.paragraph}>
              Thank you for your interest in Sim Studio. We've added your email ({email}) to our
              waitlist and will notify you as soon as you're granted access.
            </Text>
            <Text style={baseStyles.paragraph}>
              <strong>Want to get access sooner?</strong> Tell us about your use case! Schedule a
              15-minute call with our team to discuss how you plan to use Sim Studio.
            </Text>
            <Link href={calendlyLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Schedule a Call</Text>
            </Link>
            <Text style={baseStyles.paragraph}>
              We're excited to help you build, test, and optimize your agentic workflows.
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

export default WaitlistConfirmationEmail
