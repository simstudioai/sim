import { createLogger } from '@sim/logger'
import type { ResolvedOutboundRoute } from '@/lib/core/network/config.server'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'

const logger = createLogger('OutboundFetch')

let gatewayTransport: ReturnType<typeof createSsrfGuardedFetchWithDispatcher> | undefined

/**
 * The outbound route for a request made on an organization's behalf. Outside any outbound scope
 * it is direct, with a warning, unless `requireScope` is set: these requests always went direct,
 * and failing closed with `MISSING_SCOPE` (as the SSRF-guarded helpers do) would turn a code path
 * that never established a scope into an outage for every organization. A blocked route or an
 * unavailable gateway still throws.
 */
export async function resolveOrganizationRoute(
  host: string | undefined,
  options: { requireScope?: boolean } = {}
): Promise<ResolvedOutboundRoute> {
  try {
    return await resolveCurrentOutboundRoute()
  } catch (error) {
    const missingScope = error instanceof OutboundRoutingError && error.code === 'MISSING_SCOPE'
    if (!missingScope || options.requireScope) throw error
    logger.warn('Outbound request made without an organization scope', { host })
    return { kind: 'direct' }
  }
}

/**
 * `fetch` for a request Sim makes on an organization's behalf to a destination outside Sim (a
 * token endpoint, a customer's tenant host, a vendor API). An organization with a dedicated
 * egress gateway sends it from its static IPs; every other route is the global `fetch`,
 * unchanged. Never use it for Sim's own infrastructure.
 */
export const outboundFetch: typeof fetch = (input, init) => routedFetch(input, init, false)

/**
 * {@link outboundFetch} for a caller that always runs inside an outbound scope, such as a
 * knowledge connector sync, so a lost scope fails with `MISSING_SCOPE` instead of going direct.
 */
export const scopedOutboundFetch: typeof fetch = (input, init) => routedFetch(input, init, true)

async function routedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  requireScope: boolean
): Promise<Response> {
  const route = await resolveOrganizationRoute(requestHost(input), { requireScope })
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
