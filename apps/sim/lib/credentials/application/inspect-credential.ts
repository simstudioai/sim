import {
  defineAuthorizedCredentialUseCase,
  requireCredentialAccess,
  requireManageableCredentialType,
} from '@/lib/credentials/application/authorized-credential-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { readCredentialAccountMetadata } from '@/lib/credentials/queries'
import { extractSlackTeamId } from '@/lib/oauth/slack'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'

export interface InspectCredentialInput {
  credentialId: string
  assertedWorkspaceId: string
}

export interface CredentialDiagnostics {
  identity: {
    source: 'credential' | 'linked-account' | 'unknown'
    subjectId: string | null
    tenantId: string | null
    externalAccountId: string | null
    verifiedLive: false
  }
  scopes: { source: 'credential' | 'linked-account' | 'unknown'; values: string[] }
  notes: string[]
}

/** Reads only stored connection metadata after canonical workspace and credential authorization. */
export const inspectCredential = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.inspect,
  resolveContext: ({ input }: { input: InspectCredentialInput }) =>
    resolveCredentialApplicationContext(input),
  async execute({ principal, context }) {
    const { credential } = context
    requireManageableCredentialType(principal, credential)
    const access = requireCredentialAccess(context)
    const linked =
      credential.type === 'oauth' && credential.accountId && credential.providerId
        ? await readCredentialAccountMetadata(credential.accountId, credential.providerId)
        : null
    const storedScopes = credential.grantedScopes
    const isSlack =
      credential.providerId === 'slack' || credential.providerId === SLACK_CUSTOM_BOT_PROVIDER_ID
    const diagnostics: CredentialDiagnostics = {
      identity: {
        source:
          credential.providerSubjectId || credential.providerTenantId
            ? 'credential'
            : linked
              ? 'linked-account'
              : 'unknown',
        subjectId: credential.providerSubjectId ?? null,
        tenantId:
          credential.providerTenantId ??
          (isSlack ? extractSlackTeamId(linked?.externalAccountId) : null),
        externalAccountId: linked?.externalAccountId ?? null,
        verifiedLive: false,
      },
      scopes: {
        source:
          storedScopes != null
            ? 'credential'
            : linked?.scope != null
              ? 'linked-account'
              : 'unknown',
        values: [...new Set(storedScopes ?? linked?.scope?.split(/[\s,]+/).filter(Boolean) ?? [])],
      },
      notes: [
        'Stored metadata only: this does not contact the provider, verify token validity, or prove access to a particular resource. Display names are labels, not verified identities.',
      ],
    }
    if (linked)
      diagnostics.notes.push(
        'externalAccountId is the stored OAuth connection identifier and may include installation suffixes; it is not necessarily the identity currently acting at the provider.'
      )
    if (diagnostics.identity.source === 'unknown')
      diagnostics.notes.push(
        'No non-secret identity metadata is stored for this connection. Secret payloads are not decrypted for inspection.'
      )
    if (diagnostics.scopes.source === 'unknown')
      diagnostics.notes.push(
        'Granted scopes are unknown. Provider defaults and available tool definitions do not establish this credential’s actual grants.'
      )
    if (isSlack)
      diagnostics.notes.push(
        'Slack bot access is limited by the installed app’s grants and conversation membership. Channel IDs and a connected credential do not prove access to private channels, messages, or files; invite the bot to the conversation and check missing_scope/not_in_channel errors for the selected credential.'
      )
    return { credential, access, diagnostics }
  },
})
