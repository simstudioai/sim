import { Link, Section, Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
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
      <Text style={baseStyles.greeting}>Hello {userName},</Text>
      <Text style={baseStyles.paragraph}>
        Your <EmailStrong>Enterprise Plan</EmailStrong> is now active. You have full access to
        advanced features and increased capacity for your workflows.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Next steps</Text>
        <Text style={baseStyles.infoBoxList}>
          • Invite teammates to your organization
          <br />• Start building your workflows
        </Text>
      </Section>

      <EmailButton href={effectiveLoginLink}>Open {brand.name}</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Questions? Reply to this email or contact us at{' '}
        <Link href={`mailto:${brand.supportEmail}`} style={baseStyles.link}>
          {brand.supportEmail}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export default EnterpriseSubscriptionEmail
