import { requestJson } from '@/lib/api/client/request'
import { oauthTokenContract } from '@/lib/api/contracts/selectors'

export interface OAuthTokenBundle {
  accessToken: string
  cloudId?: string
  domain?: string
}

/**
 * Returns the access token plus any provider-specific extras (e.g. `cloudId` for
 * Atlassian service accounts whose tokens cannot call api.atlassian.com/oauth/token/accessible-resources).
 */
export async function fetchOAuthToken(
  credentialId: string,
  workflowId?: string
): Promise<OAuthTokenBundle | null> {
  if (!credentialId) return null
  const token = await requestJson(oauthTokenContract, {
    body: { credentialId, workflowId },
  })
  if (!token.accessToken) return null
  return {
    accessToken: token.accessToken,
    cloudId: token.cloudId,
    domain: token.domain,
  }
}
