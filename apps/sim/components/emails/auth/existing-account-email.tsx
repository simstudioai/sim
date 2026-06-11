import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface ExistingAccountEmailProps {
  username?: string
}

/**
 * Sent out-of-band when someone attempts to sign up with an email that already
 * has an account. The sign-up endpoint itself returns a generic success
 * response to avoid account enumeration, so this email is how the real account
 * owner learns of the attempt.
 */
export function ExistingAccountEmail({ username = '' }: ExistingAccountEmailProps) {
  const brand = getBrandConfig()
  const loginLink = `${getBaseUrl()}/login`

  return (
    <EmailLayout
      preview={`Someone tried to sign up with your ${brand.name} email`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello {username},</Text>
      <Text style={baseStyles.paragraph}>
        Someone just tried to create a {brand.name} account using this email address, but an account
        already exists. If this was you, sign in instead — or reset your password if you've
        forgotten it.
      </Text>

      <Link href={loginLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Sign In</Text>
      </Link>

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        If this wasn't you, no action is needed — no account was created or changed.
      </Text>
    </EmailLayout>
  )
}

export default ExistingAccountEmail
