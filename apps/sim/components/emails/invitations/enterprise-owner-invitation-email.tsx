import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'

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
  return (
    <EmailLayout
      preview={`Activate ${organizationName}'s Enterprise plan on Sim`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.greeting}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        You were selected as the owner of <EmailStrong>{organizationName}</EmailStrong> on Sim.
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
