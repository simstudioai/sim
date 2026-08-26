import type { Principal } from '@sim/auth/principal'
import type { CredentialAccessResult } from '@/lib/auth/credential-access'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import { selectorCredentialMatchesService } from '@/lib/selectors/application/credential-provider'
import { resolveAuthorizedSelectorContext } from '@/lib/selectors/server/resolve-authorized-context'
import { isEnvVarReference } from '@/executor/constants'

const SAFE_RESOLUTION_ERROR = 'Unable to resolve selector configuration'

export type SlackSelectorCredentialResult =
  | {
      ok: true
      accessToken: string
      isBotToken: boolean
      credentialAccess?: CredentialAccessResult
    }
  | { ok: false; status: number; error: string }

/** Resolves direct Slack bot-token references and credential ids behind one authorization path. */
export async function resolveSlackSelectorCredential(
  principal: Principal,
  input: { credential: string; workflowId?: string; requestId: string }
): Promise<SlackSelectorCredentialResult> {
  let credential = input.credential
  const isReferencedBotToken = isEnvVarReference(credential)
  const isLiteralBotToken = credential.startsWith('xoxb-')

  if (isReferencedBotToken || isLiteralBotToken) {
    if (!input.workflowId) {
      return { ok: false, status: 400, error: SAFE_RESOLUTION_ERROR }
    }
    const resolution = await resolveAuthorizedSelectorContext(principal, {
      workflowId: input.workflowId,
      context: { credential },
    })
    if (!resolution.ok) return resolution
    credential = resolution.context.credential

    if (credential.startsWith('xoxb-')) {
      return { ok: true, accessToken: credential, isBotToken: true }
    }
    return { ok: false, status: 400, error: SAFE_RESOLUTION_ERROR }
  }

  const resolution = await resolveAuthorizedSelectorContext(principal, {
    workflowId: input.workflowId,
    credentialId: credential,
    context: {},
  })
  if (!resolution.ok) return resolution

  const credentialAccess = resolution.credentialAccess
  if (!credentialAccess?.credentialOwnerUserId) {
    return { ok: false, status: 403, error: 'Unauthorized' }
  }

  const providerMatches = await selectorCredentialMatchesService({
    credentialId: credential,
    credentialOwnerUserId: credentialAccess.credentialOwnerUserId,
    serviceId: 'slack',
  })
  if (!providerMatches) {
    return { ok: false, status: 400, error: 'Select a Slack credential.' }
  }

  const accessToken = await refreshAccessTokenIfNeeded(
    credential,
    credentialAccess.credentialOwnerUserId,
    input.requestId
  )
  if (!accessToken) {
    return { ok: false, status: 401, error: 'Could not retrieve access token' }
  }

  return {
    ok: true,
    accessToken,
    isBotToken: credentialAccess.credentialType !== 'oauth',
    credentialAccess,
  }
}
