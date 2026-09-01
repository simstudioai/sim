import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface EnterpriseOwnerInvitationEmailProps {
  organizationName: string
  inviteLink: string
  expiresInDays: number
}

export function EnterpriseOwnerInvitationEmail({
  organizationName,
  inviteLink,
  expiresInDays,
}: EnterpriseOwnerInvitationEmailProps) {
  const brand = getBrandConfig()
  return (
    <EmailLayout
      preview={`Activate ${organizationName}'s Enterprise plan on ${brand.name}`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.greeting}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        You were selected as the owner of <EmailStrong>{organizationName}</EmailStrong> on{' '}
        {brand.name}.
      </Text>
      <Text style={baseStyles.paragraph}>
        Review and accept the invitation to create the organization and start its Enterprise plan.
        Billing does not begin until you accept.
      </Text>
      <EmailButton href={inviteLink}>Review Enterprise invitation</EmailButton>
      <div style={baseStyles.divider} />
      <Text style={baseStyles.footnote}>
        This invitation expires in {expiresInDays} days. If you did not expect it, you can ignore
        this email.
      </Text>
    </EmailLayout>
  )
}
