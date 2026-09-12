import { AsyncLocalStorage } from 'node:async_hooks'
import { resolveOutboundRoute } from '@/lib/core/network/config.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'

interface OutboundScope {
  readonly organizationId: string | null
}

const storage = new AsyncLocalStorage<OutboundScope>()

/**
 * Established by authorized operations or jobs after loading canonical ownership.
 * Null means a verified personal workspace. Never pass a requested organization.
 */
export function runWithOutboundOrganization<T>(organizationId: string | null, run: () => T): T {
  if (organizationId !== null && (typeof organizationId !== 'string' || !organizationId)) {
    throw new OutboundRoutingError('MISSING_SCOPE')
  }
  return storage.run(Object.freeze({ organizationId }), run)
}

/** Resolves current policy per operation, rather than freezing policy for a long-running job. */
export function resolveCurrentOutboundRoute() {
  return resolveOutboundRoute(storage.getStore()?.organizationId)
}

/** Unsupported transports cannot silently escape a required gateway. */
export async function requireDirectOutboundTransport(): Promise<void> {
  const route = await resolveCurrentOutboundRoute()
  if (route.kind !== 'direct') throw new OutboundRoutingError('UNSUPPORTED_TRANSPORT')
}

/** Captures only the outbound scope for deferred callbacks; route policy is still read per call. */
export function captureOutboundScope(): <T>(run: () => T) => T {
  const scope = storage.getStore()
  return <T>(run: () => T): T => (scope ? storage.run(scope, run) : storage.exit(run))
}
