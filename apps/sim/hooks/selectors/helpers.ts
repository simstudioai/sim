import { requestJson } from '@/lib/api/client/request'
import { oauthTokenContract } from '@/lib/api/contracts/selectors'

export async function fetchOAuthToken(
  credentialId: string,
  workflowId?: string
): Promise<string | null> {
  if (!credentialId) return null
  const token = await requestJson(oauthTokenContract, {
    body: { credentialId, workflowId },
  })
  return token.accessToken ?? null
}
