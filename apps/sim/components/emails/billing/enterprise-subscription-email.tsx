import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface EnterpriseSubscriptionEmailProps {
  userName?: string
  loginLink?: string
}

export function EnterpriseSubscriptionEmail({
  userName = 'Valued User',
  loginLink,
}: EnterpriseSubscriptionEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const effectiveLoginLink = loginLink || `${baseUrl}/login`

  return (
    <EmailLayout
      preview={`Your Enterprise Plan is now active on ${brand.name}`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello {userName},</Text>
      <Text style={baseStyles.paragraph}>
        Your <strong>Enterprise Plan</strong> is now active. You have full access to advanced
        features and increased capacity for your workflows.
      </Text>

      <Link href={effectiveLoginLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Open {brand.name}</Text>
      </Link>

      <Text style={baseStyles.paragraph}>
        <strong>Next steps:</strong>
        <br />• Invite team members to your organization
        <br />• Start building your workflows
      </Text>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Questions? Reply to this email or contact us at{' '}
        <Link href={`mailto:${brand.supportEmail}`} style={baseStyles.link}>
          {brand.supportEmail}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export default EnterpriseSubscriptionEmail
