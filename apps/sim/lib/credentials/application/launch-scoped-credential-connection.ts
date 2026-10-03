import { OrchestrationError } from '@/lib/core/orchestration/types'
import { launchCredentialConnection } from '@/lib/credentials/application/launch-credential-connection'
import { launchOrganizationCredentialConnection } from '@/lib/credentials/application/organization-credentials'
import { getActiveConnectDraft } from '@/lib/credentials/connect-draft'

/** Routes an actor-bound OAuth draft through its canonical owner's authorization policy. */
export async function launchScopedCredentialConnection(
  args: Parameters<typeof launchCredentialConnection.execute>[0]
) {
  if (args.principal.kind !== 'session')
    throw new OrchestrationError('forbidden', 'Sign in to connect an account')
  const draft = await getActiveConnectDraft(args.input.draftId, args.principal.userId)
  if (!draft)
    throw new OrchestrationError('not_found', 'OAuth connection link is invalid or expired')
  if (draft.organizationId) return launchOrganizationCredentialConnection(args.principal, draft.id)
  return launchCredentialConnection.execute(args)
}
