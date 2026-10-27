import { createLogger } from '@sim/logger'
import { type AuditLogParams, ambientSurface, insertDeferredAuditEntry } from './log'

const logger = createLogger('AuditRollup')

/** How long the first entry of a rollup waits for repeats before it is written. */
const ROLLUP_WINDOW_MS = 2_000

/** Entries merged into one row; bounds the identifier arrays its metadata collects. */
const ROLLUP_MAX_ENTRIES = 100

/** Pending rollups held by the process; reaching it writes every one of them. */
const ROLLUP_MAX_PENDING = 1_000

export interface AuditRollupSummary {
  entries: number
  counters: Record<string, number>
}

/**
 * One occurrence of a repetitive audit event. Occurrences sharing a rollup key
 * within {@link ROLLUP_WINDOW_MS} become one row, and nothing an occurrence
 * carried is dropped: a lone occurrence is written exactly as `params`, and a
 * merged row sums every counter, collects every identifier, and records how
 * many occurrences it stands for and when the first and last happened.
 */
export interface AuditRollupEntry {
  /**
   * What must match, beyond the workspace, actor, action, resource, and surface
   * the rollup key always includes, for two occurrences to share a row.
   */
  key: string
  /** The row a lone occurrence writes. Its request must be absent: a merged row has no single client. */
  params: Omit<AuditLogParams, 'request'>
  /** Metadata of a merged row, before the summed counters and collected identifiers. */
  rollupMetadata: Record<string, unknown>
  /** Summed into `rollupMetadata[name]`. */
  counters: Record<string, number>
  /** Collected into `rollupMetadata[`${name}s`]`; an absent value is skipped. */
  identifiers: Record<string, string | undefined>
  describe(summary: AuditRollupSummary): string
}

interface PendingRollup {
  first: AuditRollupEntry
  surface: string | undefined
  firstAt: Date
  lastAt: Date
  entries: number
  counters: Record<string, number>
  identifiers: Map<string, string[]>
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRollup>()

/** Writes started but not finished, so a flush also waits for rows already leaving. */
const inFlight = new Set<Promise<void>>()

/**
 * Records a repetitive audit event, merging it with its repeats. Fire-and-forget
 * like `recordAudit`. Each pending row is written when its window closes, when
 * it reaches {@link ROLLUP_MAX_ENTRIES}, or on {@link flushAuditRollups}. The
 * window timer is not unref'd, so a process that ends naturally still writes it.
 */
export function recordAuditRollup(entry: AuditRollupEntry): void {
  const surface = ambientSurface()
  const { params } = entry
  const key = JSON.stringify([
    surface ?? null,
    params.workspaceId ?? null,
    params.actorId,
    params.actorName ?? null,
    params.action,
    params.resourceType,
    params.resourceId ?? null,
    entry.key,
  ])

  const existing = pending.get(key)
  if (existing) {
    mergeInto(existing, entry)
    if (existing.entries >= ROLLUP_MAX_ENTRIES) startWrite([take(key)])
    return
  }

  if (pending.size >= ROLLUP_MAX_PENDING) {
    startWrite([...pending.keys()].map(take))
  }

  const now = new Date()
  const rollup: PendingRollup = {
    first: entry,
    surface,
    firstAt: now,
    lastAt: now,
    entries: 1,
    counters: { ...entry.counters },
    identifiers: new Map(),
    timer: setTimeout(() => startWrite([take(key)]), ROLLUP_WINDOW_MS),
  }
  collectIdentifiers(rollup, entry)
  pending.set(key, rollup)
}

/**
 * Writes every pending row now and waits for writes already started. Work that
 * may be frozen or ended once it returns (a workflow run) awaits this at its
 * end. Never throws.
 */
export async function flushAuditRollups(): Promise<void> {
  if (pending.size > 0) startWrite([...pending.keys()].map(take))
  await Promise.all(inFlight)
}

function startWrite(rollups: PendingRollup[]): void {
  const done = writePending(rollups)
  inFlight.add(done)
  void done.finally(() => inFlight.delete(done))
}

function mergeInto(rollup: PendingRollup, entry: AuditRollupEntry): void {
  rollup.entries += 1
  rollup.lastAt = new Date()
  for (const [name, value] of Object.entries(entry.counters)) {
    rollup.counters[name] = (rollup.counters[name] ?? 0) + value
  }
  collectIdentifiers(rollup, entry)
}

function collectIdentifiers(rollup: PendingRollup, entry: AuditRollupEntry): void {
  for (const [name, value] of Object.entries(entry.identifiers)) {
    if (value === undefined) continue
    const values = rollup.identifiers.get(name)
    if (values) values.push(value)
    else rollup.identifiers.set(name, [value])
  }
}

function take(key: string): PendingRollup {
  const rollup = pending.get(key)
  if (!rollup) throw new Error('Audit rollup is no longer pending')
  clearTimeout(rollup.timer)
  pending.delete(key)
  return rollup
}

function toAuditParams(rollup: PendingRollup): AuditLogParams {
  const { first } = rollup
  if (rollup.entries === 1) return first.params

  const metadata: Record<string, unknown> = { ...first.rollupMetadata, ...rollup.counters }
  for (const [name, values] of rollup.identifiers) metadata[`${name}s`] = values
  metadata.rollup = {
    entries: rollup.entries,
    firstAt: rollup.firstAt.toISOString(),
    lastAt: rollup.lastAt.toISOString(),
  }
  return {
    ...first.params,
    description: first.describe({ entries: rollup.entries, counters: rollup.counters }),
    metadata,
  }
}

/** One insert per row, so a row that cannot be written never takes others with it. */
async function writePending(rollups: PendingRollup[]): Promise<void> {
  await Promise.all(
    rollups.map(async (rollup) => {
      try {
        await insertDeferredAuditEntry(toAuditParams(rollup), rollup.surface)
      } catch (error) {
        logger.error('Failed to record audit log rollup', {
          error,
          action: rollup.first.params.action,
          entries: rollup.entries,
        })
      }
    })
  )
}
