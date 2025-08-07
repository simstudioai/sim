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

interface ResetPasswordEmailProps {
  username?: string
  resetLink?: string
  updatedDate?: Date
}

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'

export const ResetPasswordEmail = ({
  username = '',
  resetLink = '',
  updatedDate = new Date(),
}: ResetPasswordEmailProps) => {
  const brand = getBrandConfig()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Reset your {brand.name} password</Preview>
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
            <Text style={baseStyles.paragraph}>Hello {username},</Text>
            <Text style={baseStyles.paragraph}>
              You recently requested to reset your password for your {brand.name} account. Use the
              button below to reset it. This password reset is only valid for the next 24 hours.
            </Text>
            <Link href={resetLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Reset Your Password</Text>
            </Link>
            <Text style={baseStyles.paragraph}>
              If you did not request a password reset, please ignore this email or contact support
              if you have concerns.
            </Text>
            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The {brand.name} Team
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '40px',
                textAlign: 'left',
                color: '#666666',
              }}
            >
              This email was sent on {format(updatedDate, 'MMMM do, yyyy')} because a password reset
              was requested for your account.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default ResetPasswordEmail
