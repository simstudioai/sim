import { createLogger } from '@sim/logger'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'

const logger = createLogger('OutboundFetch')

let gatewayTransport: ReturnType<typeof createSsrfGuardedFetchWithDispatcher> | undefined

/**
 * `fetch` for a request Sim makes on an organization's behalf to a destination outside Sim: a
 * credential's token endpoint, a customer's tenant host, or a vendor API. When the current
 * outbound scope belongs to an organization with a dedicated egress gateway, the request leaves
 * through that gateway, so it comes from the organization's static IPs and passes the IP
 * allowlists its destinations enforce. Every other route is the global `fetch`, unchanged.
 *
 * A call made outside any outbound scope goes direct and logs a warning instead of failing with
 * `MISSING_SCOPE` the way the SSRF-guarded helpers do: these requests always went direct, and
 * failing closed would turn a code path that never established a scope into an outage for every
 * organization. A blocked route or an unavailable gateway still fails closed.
 *
 * Never use it for Sim's own infrastructure (its storage, queues, or internal services), which
 * must not leave through a customer's gateway.
 */
export const outboundFetch: typeof fetch = (input, init) => routedFetch(input, init, false)

/**
 * {@link outboundFetch} for a caller that always runs inside an outbound scope, such as a
 * knowledge connector sync: a missing scope throws `MISSING_SCOPE` instead of going direct, so a
 * lost scope fails loudly rather than leaving from a shared IP.
 */
export const scopedOutboundFetch: typeof fetch = (input, init) => routedFetch(input, init, true)

async function routedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  requireScope: boolean
): Promise<Response> {
  let route: Awaited<ReturnType<typeof resolveCurrentOutboundRoute>>
  try {
    route = await resolveCurrentOutboundRoute()
  } catch (error) {
    const missingScope = error instanceof OutboundRoutingError && error.code === 'MISSING_SCOPE'
    if (!missingScope || requireScope) throw error
    logger.warn('Outbound request made without an organization scope', {
      host: requestHost(input),
    })
    return fetch(input, init)
  }
  if (route.kind === 'direct') return fetch(input, init)
  gatewayTransport ??= createSsrfGuardedFetchWithDispatcher({ profile: 'configuredEndpoint' })
  return gatewayTransport.fetch(input, init)
}

function requestHost(input: RequestInfo | URL): string | undefined {
  try {
    return new URL(input instanceof Request ? input.url : input.toString()).host
  } catch {
    return undefined
  }
}
