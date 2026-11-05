import 'server-only'
import { headers } from 'next/headers'
import { ApiClientError } from '@/lib/api/client/errors'
import { type ApiClientRequest, contractUrl } from '@/lib/api/client/request'
import type { AnyApiRouteContract, ContractJsonResponse } from '@/lib/api/contracts'

/** What the main app's session policies and request logging read from the viewer's own request. */
const FORWARDED_HEADERS = ['cookie', 'user-agent', 'x-forwarded-for'] as const

/**
 * `requestJson` for this app's server: the same contract and response validation, sent to the main
 * app with the viewer's credentials. The Platform has no database, so this is its only server read.
 */
export async function serverRequestJson<C extends AnyApiRouteContract>(
  contract: C,
  input: ApiClientRequest<C>
): Promise<ContractJsonResponse<C>> {
  const incoming = await headers()
  const forwarded = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name)
    if (value) forwarded.set(name, value)
  }
  const url = new URL(contractUrl(contract, input), process.env.SIM_PLATFORM_API_ORIGIN)
  const response = await fetch(url, {
    headers: forwarded,
    cache: 'no-store',
    signal: input.signal,
  })
  if (!response.ok) {
    throw new ApiClientError({
      status: response.status,
      message: `${contract.method} ${contract.path} answered ${response.status}`,
      body: undefined,
    })
  }
  return contract.response.schema.parse(await response.json()) as ContractJsonResponse<C>
}
