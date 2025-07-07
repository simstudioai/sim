import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  Row,
  Column,
} from '@react-email/components'
import { whitelabelConfig } from '@/lib/whitelabel'

interface OTPVerificationEmailProps {
  otp: string
  email?: string
  type?: 'email-verification' | 'sign-in' | 'forget-password' | 'chat-access'
  chatTitle?: string
}

const baseUrl = whitelabelConfig.appUrl

const baseStyles = {
  main: {
    backgroundColor: '#ffffff',
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
  },
  container: {
    margin: '0 auto',
    padding: '20px 0 48px',
    maxWidth: '560px',
  },
  sectionsBorders: {
    width: '100%',
    borderBottom: '1px solid #e6ebf1',
    borderLeft: '1px solid #e6ebf1',
    borderRight: '1px solid #e6ebf1',
  },
  sectionBorder: {
    borderBottom: '1px solid #e6ebf1',
    borderLeft: '1px solid #e6ebf1',
    borderRight: '1px solid #e6ebf1',
  },
  sectionCenter: {
    padding: '0 40px',
  },
  section: {
    padding: '0 40px',
  },
  sectionText: {
    fontSize: '16px',
    lineHeight: '24px',
    color: '#525f7f',
  },
  sectionLink: {
    fontSize: '16px',
    textDecoration: 'underline',
  },
  footer: {
    borderTop: '1px solid #e6ebf1',
    color: '#8898aa',
    fontSize: '12px',
    lineHeight: '16px',
    textAlign: 'center' as const,
    marginTop: '12px',
    marginBottom: '24px',
  },
}

const getSubjectByType = (type: string, chatTitle?: string) => {
  switch (type) {
    case 'sign-in':
      return `Sign in to ${whitelabelConfig.appName}`
    case 'forget-password':
      return `Reset your password for ${whitelabelConfig.appName}`
    case 'chat-access':
      return `Access ${chatTitle || 'the chat'}`
    default:
      return `Welcome to ${whitelabelConfig.appName}`
  }
}

export const OTPVerificationEmail = ({
  otp,
  email = '',
  type = 'email-verification',
  chatTitle,
}: OTPVerificationEmailProps) => {
  // Get a message based on the type
  const getMessage = () => {
    switch (type) {
      case 'sign-in':
        return `Sign in to ${whitelabelConfig.appName}`
      case 'forget-password':
        return `Reset your password for ${whitelabelConfig.appName}`
      case 'chat-access':
        return `Access ${chatTitle || 'the chat'}`
      default:
        return `Welcome to ${whitelabelConfig.appName}`
    }
  }

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{getSubjectByType(type, chatTitle)}</Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={`${baseUrl}/static/sim.png`}
                  width='114'
                  alt={whitelabelConfig.appName}
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
          <Section style={baseStyles.section}>
            <Heading style={{ fontSize: '24px', fontWeight: 'bold', textAlign: 'center' }}>
              {getMessage()}
            </Heading>
            <Text style={baseStyles.sectionText}>
              Hi there,
            </Text>
            <Text style={baseStyles.sectionText}>
              Your verification code is:
            </Text>
            <Text
              style={{
                fontSize: '32px',
                fontWeight: 'bold',
                textAlign: 'center' as const,
                letterSpacing: '8px',
                color: whitelabelConfig.primaryColor,
                margin: '20px 0',
              }}
            >
              {otp}
            </Text>
            <Text style={baseStyles.sectionText}>
              This code will expire in 10 minutes. If you didn't request this code, please ignore this email.
            </Text>
          </Section>
          <Section style={baseStyles.sectionsBorders}>
            <Row>
              <Column style={baseStyles.sectionBorder} />
              <Column style={baseStyles.sectionCenter} />
              <Column style={baseStyles.sectionBorder} />
            </Row>
          </Section>
          <Section style={baseStyles.section}>
            <Text style={baseStyles.sectionText}>
              Thanks,<br />
              The {whitelabelConfig.appName} Team
            </Text>
          </Section>
          <Section style={baseStyles.footer}>
            <Text>
              © 2024 {whitelabelConfig.companyName}. All rights reserved.
            </Text>
            <Text>
              <Link href={whitelabelConfig.appUrl} style={baseStyles.sectionLink}>
                {whitelabelConfig.appUrl}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default OTPVerificationEmail
