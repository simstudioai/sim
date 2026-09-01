import { render } from 'react-email'
import { CredentialGroupInvitationEmail } from '@/components/emails/credential-groups/credential-group-invitation-email'

export async function renderCredentialGroupInvitationEmail(params: {
  recipientEmail: string
  inviterName?: string
  workspaceName: string
  credentialGroupName: string
  invitationLink: string
}): Promise<string> {
  return await render(CredentialGroupInvitationEmail(params))
}
