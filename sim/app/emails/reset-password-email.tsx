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
import { DiscordIcon, XIcon } from './email-icons'

interface ResetPasswordEmailProps {
  username?: string
  resetLink?: string
  updatedDate?: Date
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'

export const ResetPasswordEmail = ({
  username = '',
  resetLink = 'https://simstudio.ai/reset-password',
  updatedDate = new Date(),
}: ResetPasswordEmailProps) => {
  const formattedDate = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(updatedDate)

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Reset your Sim Studio password</Preview>
        <Container style={baseStyles.container}>
          <Section style={baseStyles.header}>
            <Img
              src={`${baseUrl}/sim.png`}
              width="120"
              height="40"
              alt="Sim Studio"
              style={{ display: 'block', objectFit: 'contain' }}
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
            <Text style={baseStyles.paragraph}>Hello {username},</Text>
            <Text style={baseStyles.paragraph}>
              We received a request to reset your Sim Studio password. Click the button below to set
              a new password:
            </Text>
            <Section style={{ textAlign: 'center' }}>
              <Link style={baseStyles.button} href={resetLink}>
                Reset Password
              </Link>
            </Section>
            <Text style={baseStyles.paragraph}>
              If you did not request a password reset, please ignore this email or contact support
              if you have concerns.
            </Text>
            <Text style={baseStyles.paragraph}>
              For security reasons, this password reset link will expire in 24 hours.
            </Text>
            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Studio Team
            </Text>
          </Section>
        </Container>

        <Section style={baseStyles.footer}>
          <Row style={{ marginBottom: '10px' }}>
            <Column align="center">
              <Link
                href="https://x.com/simstudioai"
                style={{ textDecoration: 'none', margin: '0 8px' }}
              >
                <XIcon />
              </Link>
              <Link
                href="https://discord.gg/crdsGfGk"
                style={{ textDecoration: 'none', margin: '0 8px' }}
              >
                <DiscordIcon />
              </Link>
            </Column>
          </Row>
          <Text style={baseStyles.footerText}>
            © {new Date().getFullYear()} Sim Studio, All Rights Reserved
            <br />
            If you have any questions, please contact us at support@simstudio.ai
          </Text>
        </Section>
      </Body>
    </Html>
  )
}

export default ResetPasswordEmail
