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
                href="https://twitter.com/SimStudioAI"
                style={{ textDecoration: 'none', margin: '0 8px' }}
              >
                <svg width="24" height="24" viewBox="0 0 16 16" style={{ color: '#666666' }}>
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M0.5 0.5H5.75L9.48421 5.71053L14 0.5H16L10.3895 6.97368L16.5 15.5H11.25L7.51579 10.2895L3 15.5H1L6.61053 9.02632L0.5 0.5ZM12.0204 14L3.42043 2H4.97957L13.5796 14H12.0204Z"
                    fill="currentColor"
                  />
                </svg>
              </Link>
              <Link
                href="https://discord.gg/simstudio"
                style={{ textDecoration: 'none', margin: '0 8px' }}
              >
                <svg width="24" height="24" viewBox="0 0 16 16" style={{ color: '#666666' }}>
                  <path
                    d="M13.5535 3.01557C12.5023 2.5343 11.3925 2.19287 10.2526 2C10.0966 2.27886 9.95547 2.56577 9.82976 2.85952C8.6155 2.67655 7.38067 2.67655 6.16641 2.85952C6.04063 2.5658 5.89949 2.27889 5.74357 2C4.60289 2.1945 3.4924 2.53674 2.44013 3.01809C0.351096 6.10885 -0.215207 9.12285 0.0679444 12.0941C1.29133 12.998 2.66066 13.6854 4.11639 14.1265C4.44417 13.6856 4.73422 13.2179 4.98346 12.7283C4.51007 12.5515 4.05317 12.3334 3.61804 12.0764C3.73256 11.9934 3.84456 11.9078 3.95279 11.8248C5.21891 12.4202 6.60083 12.7289 7.99997 12.7289C9.39912 12.7289 10.781 12.4202 12.0472 11.8248C12.1566 11.9141 12.2686 11.9997 12.3819 12.0764C11.9459 12.3338 11.4882 12.5524 11.014 12.7296C11.2629 13.2189 11.553 13.6862 11.881 14.1265C13.338 13.6872 14.7084 13.0001 15.932 12.0953C16.2642 8.64968 15.3644 5.66336 13.5535 3.01557ZM5.34212 10.2668C4.55307 10.2668 3.90119 9.55073 3.90119 8.66981C3.90119 7.78889 4.53042 7.06654 5.3396 7.06654C6.14879 7.06654 6.79563 7.78889 6.78179 8.66981C6.76795 9.55073 6.14627 10.2668 5.34212 10.2668ZM10.6578 10.2668C9.86752 10.2668 9.21815 9.55073 9.21815 8.66981C9.21815 7.78889 9.84738 7.06654 10.6578 7.06654C11.4683 7.06654 12.1101 7.78889 12.0962 8.66981C12.0824 9.55073 11.462 10.2668 10.6578 10.2668Z"
                    fill="currentColor"
                  />
                </svg>
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
