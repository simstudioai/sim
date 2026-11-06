import { LRUCache } from 'lru-cache'

const PROTOCOL_PROBE_TTL_MS = 30_000

/**
 * Worker protocol support keyed by base URL, shared by turn hints and sandbox leases. Only an OK
 * health response is cached; a failed probe rejects, so an outage reads as unsupported for that
 * call without being remembered.
 */
const protocolSupport = new LRUCache<string, boolean>({
  max: 64,
  ttl: PROTOCOL_PROBE_TTL_MS,
  fetchMethod: async (baseURL) => {
    // boundary-raw-fetch: the selected worker advertises its live file-owner protocol in health headers.
    const response = await fetch(`${baseURL}/healthz`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) throw new Error(`Worker health probe returned ${response.status}`)
    return response.headers.get('X-Mothership-File-Owner-Protocol') === '1'
  },
})

/** Negotiates against the selected worker; redirects cannot establish another peer's support. */
export async function supportsFileOwnerProtocol(baseURL: string): Promise<boolean> {
  try {
    return (await protocolSupport.fetch(baseURL.replace(/\/$/, ''))) === true
  } catch {
    return false
  }
}
