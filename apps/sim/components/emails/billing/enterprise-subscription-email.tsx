import { Link, Section, Text } from '@react-email/components'
import { SIM_SUPPORT_EMAIL } from '@sim/utils/site'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface EnterpriseSubscriptionEmailProps {
  userName?: string
  loginLink?: string
}

export function EnterpriseSubscriptionEmail({
  userName = 'Valued User',
  loginLink,
}: EnterpriseSubscriptionEmailProps) {
  const baseUrl = getBaseUrl()
  const effectiveLoginLink = loginLink || `${baseUrl}/login`

  return (
    <EmailLayout preview={`Your Enterprise Plan is now active on Sim`} showUnsubscribe={false}>
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

      <EmailButton href={effectiveLoginLink}>Open Sim</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Questions? Reply to this email or contact us at{' '}
        <Link href={`mailto:${SIM_SUPPORT_EMAIL}`} style={baseStyles.link}>
          {SIM_SUPPORT_EMAIL}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export default EnterpriseSubscriptionEmail
