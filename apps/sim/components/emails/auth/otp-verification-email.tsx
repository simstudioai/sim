import { Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'

interface OTPVerificationEmailProps {
  otp: string
  type?: 'sign-in' | 'email-verification' | 'change-email' | 'forget-password' | 'chat-access'
  chatTitle?: string
}

const getSubjectByType = (type: string, chatTitle?: string) => {
  switch (type) {
    case 'sign-in':
      return `Sign in to Sim`
    case 'email-verification':
      return `Verify your email for Sim`
    case 'change-email':
      return `Verify your new email for Sim`
    case 'forget-password':
      return `Reset your Sim password`
    case 'chat-access':
      return `Verification code for ${chatTitle || 'Chat'}`
    default:
      return `Verification code for Sim`
  }
}

export function OTPVerificationEmail({
  otp,
  type = 'email-verification',
  chatTitle,
}: OTPVerificationEmailProps) {
  return (
    <EmailLayout preview={getSubjectByType(type, chatTitle)} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>Your verification code:</Text>

      <Section style={baseStyles.codeContainer}>
        <Text style={baseStyles.code}>{otp}</Text>
      </Section>

      <Text style={baseStyles.paragraph}>This code will expire in 15 minutes.</Text>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Do not share this code with anyone. If you didn't request this code, you can safely ignore
        this email.
      </Text>
    </EmailLayout>
  )
}

export default OTPVerificationEmail
