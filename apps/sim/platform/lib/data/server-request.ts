import 'server-only'
import { headers } from 'next/headers'
import { type ApiClientRequest, contractUrl, readContractResponse } from '@/lib/api/client/request'
import type { AnyApiRouteContract, ContractJsonResponse } from '@/lib/api/contracts'

/** What the main app's session policies and request logging read from the viewer's own request. */
const FORWARDED_HEADERS = ['cookie', 'user-agent', 'x-forwarded-for'] as const

/** Long enough for the legacy layout's own reads, short enough to reach the error state with a retry. */
const SERVER_READ_TIMEOUT_MS = 10_000

/** A slow read gives up its first-paint seat rather than hold the document; the client fetches it. */
const PREFETCH_TIMEOUT_MS = 2_000

/**
 * `requestJson` for this app's server: the same contract and response validation, sent to the main
 * app with the viewer's credentials. The Platform has no database, so this is its only server read,
 * and none of them can hold a request indefinitely.
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
  // boundary-raw-fetch: the server has no same-origin API, and this forwards the viewer's credentials
  const response = await fetch(url, {
    method: contract.method,
    headers: forwarded,
    cache: 'no-store',
    signal: input.signal ?? AbortSignal.timeout(SERVER_READ_TIMEOUT_MS),
  })
  return readContractResponse(contract, response)
}

export function prefetchRequestJson<C extends AnyApiRouteContract>(
  contract: C,
  input: ApiClientRequest<C>
): Promise<ContractJsonResponse<C>> {
  return serverRequestJson(contract, { ...input, signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS) })
}
