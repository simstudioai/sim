import { createLogger } from '@sim/logger'
import { type ApiClientRequest, requestJson } from '@/lib/api/client/request'
import { oauthTokenContract } from '@/lib/api/contracts/selectors'
import type { AnyApiRouteContract, ContractJsonResponse } from '@/lib/api/contracts/types'

const logger = createLogger('SelectorHelpers')

export async function requestSelectorContract<C extends AnyApiRouteContract>(
  contract: C,
  input: ApiClientRequest<C>
): Promise<ContractJsonResponse<C>> {
  if (contract.response.mode !== 'json') {
    logger.error('Selector contract does not declare JSON response', {
      method: contract.method,
      path: contract.path,
    })
  }

  return requestJson(contract, input)
}

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
