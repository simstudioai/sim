import { createLogger } from '@sim/logger'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('ResolvedSecretProjectionRefusal')

/**
 * Reporting is deduplicated per registry, because one run can refuse the same boundary repeatedly:
 * an agent projects tool input on every iteration of its loop, and a single latched registry would
 * otherwise emit a line per iteration.
 */
const reportedSitesByRegistry = new WeakMap<ResolvedSecretTraceRegistry, Set<string>>()

export interface ResolvedSecretProjectionRefusal {
  /**
   * Stable dotted identifier for the boundary that refused, e.g. `agent.modelInput`. Chosen by the
   * call site rather than derived, so it survives refactors and stays greppable.
   */
  site: string
  /** The message thrown to the user. Callers pass their existing text so wording never changes. */
  message: string
  /** The registry whose incompleteness caused the refusal. */
  registry?: ResolvedSecretTraceRegistry
  /**
   * Field names of the path being projected, comma-separated when several are covered at once.
   * Never a resolved value.
   */
  inputPath?: string
  /** Builds the thrown error when a call site needs its own type for control flow. */
  createError?: (message: string) => Error
}

/**
 * Records why a projection was refused, then throws the call site's own error.
 *
 * Every refusal reaches the user as the same fixed sentence whichever guard caused it, and that
 * guard may have tripped many frames — or a whole process — earlier, so this is the only point
 * where the failing boundary and the cause are both in hand.
 *
 * Returns `never`, so `if (!projection.complete) refuseResolvedSecretProjection(...)` still narrows
 * the projection for the code that follows.
 */
export function refuseResolvedSecretProjection(refusal: ResolvedSecretProjectionRefusal): never {
  reportRefusal(refusal)
  const message = refusal.message
  throw refusal.createError ? refusal.createError(message) : new Error(message)
}

function reportRefusal({ site, registry, inputPath }: ResolvedSecretProjectionRefusal): void {
  if (!shouldReport(dedupKey(site, inputPath), registry)) return

  const diagnostics = registry?.getIncompletenessDiagnostics()
  logger.error('Resolved secret projection refused', {
    site,
    ...(inputPath ? { inputPath } : {}),
    /**
     * Separates the two failure families that reach this one event: a registry that latched and
     * genuinely cannot vouch, versus a caller finding the projection's own output malformed. Only
     * the former carries reasons, so a query filtered on `reason` would otherwise silently cover
     * half of them.
     */
    cause: diagnostics ? 'registry-latched' : 'projection-cross-check',
    registryPresent: registry !== undefined,
    ...(diagnostics
      ? {
          reason: diagnostics.reasons[0],
          reasons: diagnostics.reasons,
          /** The importers that cost the run its completeness — who to go and look at. */
          ...(diagnostics.origins.length > 0 ? { origins: diagnostics.origins } : {}),
          incompleteInputPathCount: diagnostics.incompleteInputPathCount,
          activeEntryCount: diagnostics.activeEntryCount,
          ...(diagnostics.scopeWorkspaceId
            ? { scopeWorkspaceId: diagnostics.scopeWorkspaceId }
            : {}),
        }
      : {}),
  })
}

/** Distinguishes the same boundary refusing on different paths, which are different incidents. */
function dedupKey(site: string, inputPath: string | undefined): string {
  return inputPath ? `${site}\u0000${inputPath}` : site
}

/**
 * Deduplicates only against a registry, whose lifetime is the run that refused.
 *
 * A refusal with no registry is never deduplicated: those sites abort the request rather than
 * iterate, so each reaches this at most once per request, and any process-wide memory of them would
 * silence every later request — including the one being investigated. A new registry-less site
 * placed inside a loop would therefore repeat; give it a registry instead.
 */
function shouldReport(key: string, registry: ResolvedSecretTraceRegistry | undefined): boolean {
  if (!registry) return true

  const reported = reportedSitesByRegistry.get(registry) ?? new Set<string>()
  reportedSitesByRegistry.set(registry, reported)
  if (reported.has(key)) return false
  reported.add(key)
  return true
}
