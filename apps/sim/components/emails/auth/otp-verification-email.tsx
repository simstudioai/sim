import { Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

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

export function OTPVerificationEmail({
  otp,
  email = '',
  type = 'email-verification',
  chatTitle,
}: OTPVerificationEmailProps) {
  const brand = getBrandConfig()

  return (
    <EmailLayout preview={getSubjectByType(type, brand.name, chatTitle)} showUnsubscribe={false}>
      <Text style={baseStyles.paragraph}>Your verification code:</Text>

      <Section style={baseStyles.codeContainer}>
        <Text style={baseStyles.code}>{otp}</Text>
      </Section>

      <Text style={baseStyles.paragraph}>This code will expire in 15 minutes.</Text>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Do not share this code with anyone. If you didn't request this code, you can safely ignore
        this email.
      </Text>
    </EmailLayout>
  )
}

export default OTPVerificationEmail
