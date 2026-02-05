import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface ResetPasswordEmailProps {
  username?: string
  resetLink?: string
}

export function ResetPasswordEmail({ username = '', resetLink = '' }: ResetPasswordEmailProps) {
  const brand = getBrandConfig()

  return (
    <EmailLayout preview={`Reset your ${brand.name} password`} showUnsubscribe={false}>
      <Text style={baseStyles.paragraph}>Hello {username},</Text>
      <Text style={baseStyles.paragraph}>
        A password reset was requested for your {brand.name} account. Click below to set a new
        password.
      </Text>

      <Link href={resetLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Reset Password</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        If you didn't request this, you can ignore this email. Link expires in 24 hours.
      </Text>
    </EmailLayout>
  )
}

export default ResetPasswordEmail
