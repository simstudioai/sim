import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

interface OTPVerificationEmailProps {
  otp: string
  email?: string
  type?: 'sign-in' | 'email-verification' | 'forget-password'
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'

const getSubjectByType = (type: string) => {
  switch (type) {
    case 'sign-in':
      return 'Sign in to Sim Studio'
    case 'email-verification':
      return 'Verify your email for Sim Studio'
    case 'forget-password':
      return 'Reset your Sim Studio password'
    default:
      return 'Verification code for Sim Studio'
  }
}

export const OTPVerificationEmail = ({
  otp,
  email = '',
  type = 'email-verification',
}: OTPVerificationEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{getSubjectByType(type)}</Preview>
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
            <Text style={baseStyles.paragraph}>
              {type === 'sign-in'
                ? 'Sign in to'
                : type === 'forget-password'
                  ? 'Reset your password for'
                  : 'Welcome to'}{' '}
              Sim Studio!
            </Text>
            <Text style={baseStyles.paragraph}>Your verification code is:</Text>
            <Section style={baseStyles.codeContainer}>
              <Text style={baseStyles.code}>{otp}</Text>
            </Section>
            <Text style={baseStyles.paragraph}>This code will expire in 15 minutes.</Text>
            <Text style={baseStyles.paragraph}>
              If you didn't request this code, you can safely ignore this email.
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

export default OTPVerificationEmail
