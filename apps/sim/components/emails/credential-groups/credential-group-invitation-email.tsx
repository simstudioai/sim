import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface CredentialGroupInvitationEmailProps {
  recipientEmail: string
  /** Absent when a workflow issued the invitation: there is no person to name. */
  inviterName?: string
  workspaceName: string
  credentialGroupName: string
  invitationLink: string
  searchProviderName?: string
}

export function CredentialGroupInvitationEmail({
  recipientEmail,
  inviterName,
  workspaceName,
  credentialGroupName,
  invitationLink,
  searchProviderName,
}: CredentialGroupInvitationEmailProps) {
  const brand = getBrandConfig()

  return (
    <EmailLayout
      preview={
        inviterName
          ? `${inviterName} invited you to connect accounts for ${workspaceName}`
          : `You have been invited to connect accounts for ${workspaceName}`
      }
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        {inviterName ? (
          <>
            <strong>{inviterName}</strong> invited <strong>{recipientEmail}</strong>
          </>
        ) : (
          <>
            <strong>{recipientEmail}</strong> has been invited
          </>
        )}{' '}
        {searchProviderName ? (
          <>
            to connect your {searchProviderName} account for Search in{' '}
            <strong>{workspaceName}</strong>.
          </>
        ) : (
          <>
            to connect accounts for <strong>{credentialGroupName}</strong> in the{' '}
            <strong>{workspaceName}</strong> workspace on {brand.name}.
          </>
        )}
      </Text>
      {searchProviderName && (
        <Text style={baseStyles.paragraph}>
          This requests an account connection. It does not add you as an organization member.
        </Text>
      )}

      <Link href={invitationLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>
          {searchProviderName ? `Connect ${searchProviderName}` : 'Connect Accounts'}
        </Text>
      </Link>

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        This private link expires in 7 days. {brand.name} will send you to each provider to sign in
        and will never ask for your provider password. If you did not expect this invitation, you
        can ignore it.
      </Text>
    </EmailLayout>
  )
}

export default CredentialGroupInvitationEmail
