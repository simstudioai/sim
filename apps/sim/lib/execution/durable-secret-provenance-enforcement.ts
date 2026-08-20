import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('DurableSecretProvenanceEnforcement')

/**
 * Durable stores that can hand a run a value whose secret provenance was never recorded.
 *
 * Named by the call site rather than derived, so the surface survives refactors and stays
 * greppable — the same convention the projection-refusal `site` strings use.
 */
export const DURABLE_SECRET_PROVENANCE_SURFACES = ['memory', 'table-row', 'knowledge'] as const

export type DurableSecretProvenanceSurface = (typeof DURABLE_SECRET_PROVENANCE_SURFACES)[number]

/** Reads the configured surfaces once; an unrecognized name is reported rather than assumed. */
function resolveEnforcedSurfaces(): ReadonlySet<DurableSecretProvenanceSurface> {
  const configured = env.DURABLE_SECRET_PROVENANCE_ENFORCED_SURFACES?.trim()
  if (!configured) return new Set()

  const requested = configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
  if (requested.includes('all')) return new Set(DURABLE_SECRET_PROVENANCE_SURFACES)

  const enforced = new Set<DurableSecretProvenanceSurface>()
  const unrecognized: string[] = []
  for (const entry of requested) {
    const surface = DURABLE_SECRET_PROVENANCE_SURFACES.find((candidate) => candidate === entry)
    if (surface) enforced.add(surface)
    else unrecognized.push(entry)
  }
  if (unrecognized.length > 0) {
    logger.error('Ignoring unrecognized durable secret provenance surfaces', {
      unrecognized,
      supported: [...DURABLE_SECRET_PROVENANCE_SURFACES],
    })
  }
  return enforced
}

let enforcedSurfaces: ReadonlySet<DurableSecretProvenanceSurface> | undefined

/**
 * True when unrecorded provenance from this surface must fail the run rather than warn.
 *
 * Nothing is enforced by default. `unknown` provenance means "nobody recorded what secrets this
 * value carries", which is the same thing a pre-tracking legacy row says — and legacy rows are read
 * as carrying none. Enforcing one and not the other made an *aware* writer that momentarily could
 * not vouch strictly worse than an unaware one: the row it wrote latched every run that later read
 * it, and each latched run wrote more such rows, so a workspace could not recover without a data
 * repair.
 *
 * Warning instead keeps that state visible and measurable while the writers that produce it are
 * fixed. The sidecar still records `unknown` faithfully, so a surface can be closed back up once
 * its writers stop losing provenance — and the rows that will start failing are countable from the
 * sidecar table before the switch is thrown. This is a deliberate posture: an unenforced surface
 * can under-redact a value whose provenance was lost.
 *
 * Set `DURABLE_SECRET_PROVENANCE_ENFORCED_SURFACES` to `all`, or to a comma-separated subset of
 * {@link DURABLE_SECRET_PROVENANCE_SURFACES}, to close a surface.
 *
 * Workspace files are deliberately not a surface here: their unknown check sits in the callers
 * rather than in the shared import, and one unknown file locks vfs reads, chat attachments, sandbox
 * mounts, and the file tool routes at once. They stay fail-closed until that is its own decision.
 */
export function isDurableSecretProvenanceEnforced(
  surface: DurableSecretProvenanceSurface
): boolean {
  enforcedSurfaces ??= resolveEnforcedSurfaces()
  return enforcedSurfaces.has(surface)
}

/**
 * What a surface could not vouch for.
 *
 * A closed union rather than a free-form string, for the reason the resolved-secret registry's
 * reason set is one: a surface stays open on the strength of these lines trending to zero, and a
 * cause that a call site can spell freely cannot be aggregated or alerted on.
 */
export type UnrecordedDurableProvenanceCause =
  | 'durable-provenance-unknown'
  | 'row-sidecar-not-exact'
  | 'stored-memory-provenance-unknown'

export interface UnrecordedDurableProvenanceReport {
  surface: DurableSecretProvenanceSurface
  cause: UnrecordedDurableProvenanceCause
  /** How many records in this one read were unrecorded, when the caller reads a page at a time. */
  affectedCount?: number
  workspaceId?: string
  /**
   * Whose access authorized the read. Null where the surface cannot name one — an audit row with
   * no actor still carries the workspace, surface, and cause, which is what the trail is for.
   */
  actorUserId?: string | null
}

/**
 * Records that a read proceeded on provenance nobody wrote down.
 *
 * Error, not warn, for the same reason the originating-fault reasons use it: error is the only
 * level that survives every default the logger falls back to — production, test, and a self-hosted
 * chart that sets no `LOG_LEVEL`. A surface stays open on the strength of this line being visible
 * and trending to zero, so a level that a deployment can silently filter would leave the posture
 * unmeasured. It is deliberately noisy on an affected workspace; that is the signal.
 */
export function reportUnrecordedDurableProvenance(report: UnrecordedDurableProvenanceReport): void {
  logger.error('Proceeding on unrecorded durable secret provenance', {
    surface: report.surface,
    cause: report.cause,
    enforced: false,
    ...(report.affectedCount !== undefined ? { affectedCount: report.affectedCount } : {}),
    ...(report.workspaceId ? { workspaceId: report.workspaceId } : {}),
  })

  /**
   * The log line is for us; this is for the people who own the secrets.
   *
   * Recorded here rather than where provenance was lost, because losing it costs nothing on its
   * own — a write nobody could vouch for is just data at rest. The exposure is this moment: a
   * value crossing into a run that will project it to a model with no way to recognise a secret
   * inside it and redact it. That is what a reader needs told, and it is why the entry names the
   * surface and the count rather than a secret, which is precisely what was not recorded.
   *
   * Fire-and-forget by construction — `recordAudit` never throws — so the trail can never be the
   * reason a run fails. Skipped without a workspace: the entry would name no one it concerns.
   */
  if (!report.workspaceId) return
  recordAudit({
    workspaceId: report.workspaceId,
    actorId: report.actorUserId ?? null,
    action: AuditAction.SECRET_PROVENANCE_UNRECORDED,
    resourceType: AuditResourceType.SECRET_PROVENANCE,
    resourceId: report.surface,
    description:
      'A run read data whose secret provenance was never recorded, so any secret it carries could not be redacted before reaching a model.',
    metadata: {
      surface: report.surface,
      cause: report.cause,
      ...(report.affectedCount !== undefined ? { affectedCount: report.affectedCount } : {}),
    },
  })
}

/** Test seam: forces the next read to re-resolve the env-configured surfaces. */
export function resetDurableSecretProvenanceEnforcementCache(): void {
  enforcedSurfaces = undefined
}
