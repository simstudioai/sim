import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'

interface ResetPasswordEmailProps {
  username?: string
  resetLink?: string
}

export function ResetPasswordEmail({ username = '', resetLink = '' }: ResetPasswordEmailProps) {
  return (
    <EmailLayout preview={`Reset your Sim password`} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>Hello {username},</Text>
      <Text style={baseStyles.paragraph}>
        A password reset was requested for your Sim account. Click below to set a new password.
      </Text>

      <EmailButton href={resetLink}>Reset Password</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        If you didn't request this, you can ignore this email. Link expires in 24 hours.
      </Text>
    </EmailLayout>
  )
}

export default ResetPasswordEmail
