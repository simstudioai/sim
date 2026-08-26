import {
  getAtlassianServiceAccountSecret,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/lib/oauth/credential-service'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { selectorCredentialMatchesService } from '@/lib/selectors/application/credential-provider'

export async function resolveAtlassianSelectorCredential(input: {
  credentialId: string
  credentialOwnerUserId: string
  requestId: string
  serviceId: 'jira' | 'confluence'
}): Promise<{ accessToken: string; cloudId?: string } | null> {
  const providerMatches = await selectorCredentialMatchesService({
    credentialId: input.credentialId,
    credentialOwnerUserId: input.credentialOwnerUserId,
    serviceId: input.serviceId,
  })
  if (!providerMatches) return null

  const resolved = await resolveOAuthAccountId(input.credentialId)
  if (resolved?.providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID && resolved.credentialId) {
    const secret = await getAtlassianServiceAccountSecret(resolved.credentialId)
    return { accessToken: secret.apiToken, cloudId: secret.cloudId }
  }

  const accessToken = await refreshAccessTokenIfNeeded(
    input.credentialId,
    input.credentialOwnerUserId,
    input.requestId
  )
  return accessToken ? { accessToken } : null
}
