import { Body, Container, Head, Html, Img, Preview, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface OTPVerificationEmailProps {
  otp: string
  email?: string
  type?: 'sign-in' | 'email-verification' | 'forget-password' | 'chat-access'
  chatTitle?: string
}

const getSubjectByType = (type: string, brandName: string, chatTitle?: string) => {
  switch (type) {
    case 'sign-in':
      return `Sign in to ${brandName}`
    case 'email-verification':
      return `Verify your email for ${brandName}`
    case 'forget-password':
      return `Reset your ${brandName} password`
    case 'chat-access':
      return `Verification code for ${chatTitle || 'Chat'}`
    default:
      return `Verification code for ${brandName}`
  }
}

export const OTPVerificationEmail = ({
  otp,
  email = '',
  type = 'email-verification',
  chatTitle,
}: OTPVerificationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{getSubjectByType(type, brand.name, chatTitle)}</Preview>

        {/* Main card container */}
        <Container style={baseStyles.container}>
          {/* Header with logo */}
          <Section style={baseStyles.header}>
            <Img
              src={brand.logoUrl || `${baseUrl}/brand/color/email/type.png`}
              width='70'
              alt={brand.name}
              style={{ display: 'block' }}
            />
          </Section>

          {/* Content */}
          <Section style={baseStyles.content}>
            <Text style={baseStyles.paragraph}>Your verification code:</Text>

            <Section style={baseStyles.codeContainer}>
              <Text style={baseStyles.code}>{otp}</Text>
            </Section>

            <Text style={baseStyles.paragraph}>This code will expire in 15 minutes.</Text>

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
              Do not share this code with anyone. If you didn't request this code, you can safely
              ignore this email.
            </Text>
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default OTPVerificationEmail
