import { Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
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
      <Text style={baseStyles.greeting}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <EmailStrong>{inviterName}</EmailStrong> added you to the{' '}
        <EmailStrong>{workspaceName}</EmailStrong> workspace on {brand.name}.
      </Text>

      <EmailButton href={workspaceLink}>Open workspace</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>If this was unexpected, contact a workspace admin.</Text>
    </EmailLayout>
  )
}

export default WorkspaceAddedEmail
