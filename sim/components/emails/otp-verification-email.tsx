import * as React from 'react'
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
          <Section
            style={{
              ...baseStyles.header,
              textAlign: 'center',
              padding: '30px',
            }}
          >
            <Img
              src={`${baseUrl}/sim.png`}
              width="114"
              alt="Sim Studio"
              style={{
                display: 'inline-block',
                margin: '0 auto',
              }}
            />
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

        <Section style={baseStyles.footer}>
          <Row>
            <Column align="right" style={{ width: '50%', paddingRight: '8px' }}>
              <Link href="https://x.com/simstudioai" style={{ textDecoration: 'none' }}>
                <Img
                  src={`${baseUrl}/x-icon.png`}
                  width="20"
                  height="20"
                  alt="X"
                  style={{
                    display: 'block',
                    marginLeft: 'auto',
                    filter: 'grayscale(100%)',
                    opacity: 0.7,
                  }}
                />
              </Link>
            </Column>
            <Column align="left" style={{ width: '50%', paddingLeft: '8px' }}>
              <Link href="https://discord.gg/crdsGfGk" style={{ textDecoration: 'none' }}>
                <Img
                  src={`${baseUrl}/discord-icon.png`}
                  width="24"
                  height="24"
                  alt="Discord"
                  style={{
                    display: 'block',
                    filter: 'grayscale(100%)',
                    opacity: 0.9,
                  }}
                />
              </Link>
            </Column>
          </Row>
          <Text
            style={{
              ...baseStyles.footerText,
              textAlign: 'center',
              color: '#706a7b',
            }}
          >
            © {new Date().getFullYear()} Sim Studio, All Rights Reserved
            <br />
            If you have any questions, please contact us at support@simstudio.ai
          </Text>
        </Section>
      </Body>
    </Html>
  )
}

export default OTPVerificationEmail
