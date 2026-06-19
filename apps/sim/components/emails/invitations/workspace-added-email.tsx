import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface WorkspaceAddedEmailProps {
  /** Name of the workspace the recipient was added to. */
  workspaceName?: string
  /** Name of the person who added the recipient. */
  inviterName?: string
  /** Direct link to the workspace (no acceptance required). */
  workspaceLink?: string
}

export function WorkspaceAddedEmail({
  workspaceName = 'Workspace',
  inviterName = 'Someone',
  workspaceLink = '',
}: WorkspaceAddedEmailProps) {
  const brand = getBrandConfig()
  const preview = `You've been added to the "${workspaceName}" workspace on ${brand.name}`

  return (
    <EmailLayout preview={preview} showUnsubscribe={false}>
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <strong>{inviterName}</strong> added you to the <strong>{workspaceName}</strong> workspace
        on {brand.name}.
      </Text>

      <Link href={workspaceLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Open workspace</Text>
      </Link>

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        If this was unexpected, contact a workspace admin.
      </Text>
    </EmailLayout>
  )
}

export default WorkspaceAddedEmail
