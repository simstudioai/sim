import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from '@sim/logger'
import { type AuditLogParams, ambientSurface, insertDeferredAuditEntry } from './log'

const logger = createLogger('AuditRollup')

/** How long the first entry of a rollup waits for repeats before it is written. */
const ROLLUP_WINDOW_MS = 2_000

/**
 * The window inside a {@link withAuditRollupScope}, whose end writes the row
 * anyway: long enough that a run's repeats share one row however far apart
 * they fall, short enough that a run whose process dies loses at most this much.
 */
const SCOPED_ROLLUP_WINDOW_MS = 60_000

/** Entries merged into one row; bounds the identifier arrays its metadata collects. */
const ROLLUP_MAX_ENTRIES = 100

/** Pending rollups held by the process; reaching it writes every one of them. */
const ROLLUP_MAX_PENDING = 1_000

/**
 * Rollup rows the process inserts at once, across every window timer, size
 * flush, and scope end, so a burst of distinct rollups never floods the pool.
 */
const ROLLUP_WRITE_CONCURRENCY = 10

export interface AuditRollupSummary {
  entries: number
  counters: Record<string, number>
}

/**
 * One occurrence of a repetitive audit event. Occurrences sharing a rollup key
 * within {@link ROLLUP_WINDOW_MS} ({@link SCOPED_ROLLUP_WINDOW_MS} inside a
 * scope) become one row, and nothing an occurrence
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

/**
 * A unit of work that owns the rollups recorded inside it (a workflow run and
 * the child runs it executes inline), so its end writes only its own rows.
 */
interface RollupScope {
  id: number
  writes: Set<Promise<void>>
}

interface PendingRollup {
  scope: RollupScope | undefined
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
const queuedWrites: Array<{ rollup: PendingRollup; written: () => void }> = []
let activeWrites = 0
const scopeStorage = new AsyncLocalStorage<RollupScope>()
let nextScopeId = 0

/**
 * Records a repetitive audit event, merging it with its repeats. Fire-and-forget
 * like `recordAudit`. Each pending row is written when its window closes, when
 * it reaches {@link ROLLUP_MAX_ENTRIES}, or when the {@link withAuditRollupScope}
 * it was recorded in ends. The window timer is not unref'd, so a process that
 * ends naturally still writes it.
 */
export function recordAuditRollup(entry: AuditRollupEntry): void {
  const surface = ambientSurface()
  const scope = scopeStorage.getStore()
  const { params } = entry
  const key = JSON.stringify([
    scope?.id ?? null,
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
    scope,
    first: entry,
    surface,
    firstAt: now,
    lastAt: now,
    entries: 1,
    counters: { ...entry.counters },
    identifiers: new Map(),
    timer: setTimeout(
      () => startWrite([take(key)]),
      scope ? SCOPED_ROLLUP_WINDOW_MS : ROLLUP_WINDOW_MS
    ),
  }
  collectIdentifiers(rollup, entry)
  pending.set(key, rollup)
}

/**
 * Runs `work` as the owner of the rollups recorded inside it, then writes them
 * and waits for those writes before returning, so work whose process may be
 * frozen or ended once it returns (a background workflow run) leaves nothing
 * pending. Other scopes' rollups keep their own window. Each write is one
 * insert, bounded by the database's statement and connect timeouts; a failed
 * one is logged, never thrown.
 */
export async function withAuditRollupScope<T>(work: () => Promise<T>): Promise<T> {
  const scope: RollupScope = { id: nextScopeId++, writes: new Set() }
  try {
    return await scopeStorage.run(scope, work)
  } finally {
    const keys = [...pending.entries()]
      .filter(([, rollup]) => rollup.scope === scope)
      .map(([key]) => key)
    if (keys.length > 0) startWrite(keys.map(take))
    await Promise.all(scope.writes)
  }
}

function startWrite(rollups: PendingRollup[]): void {
  const done = writePending(rollups)
  const scopes = new Set(rollups.map((rollup) => rollup.scope))
  for (const scope of scopes) scope?.writes.add(done)
  void done.finally(() => {
    for (const scope of scopes) scope?.writes.delete(done)
  })
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

/**
 * One insert per row, so a row that cannot be written never takes others with
 * it. Rows wait in one process-wide queue, at most
 * {@link ROLLUP_WRITE_CONCURRENCY} in flight.
 */
function writePending(rollups: PendingRollup[]): Promise<void> {
  return Promise.all(
    rollups.map(
      (rollup) =>
        new Promise<void>((written) => {
          queuedWrites.push({ rollup, written })
          drainWrites()
        })
    )
  ).then(() => undefined)
}

function drainWrites(): void {
  while (activeWrites < ROLLUP_WRITE_CONCURRENCY) {
    const next = queuedWrites.shift()
    if (!next) return
    activeWrites += 1
    void writeRollup(next.rollup).finally(() => {
      activeWrites -= 1
      next.written()
      drainWrites()
    })
  }
}

async function writeRollup(rollup: PendingRollup): Promise<void> {
  try {
    await insertDeferredAuditEntry(toAuditParams(rollup), rollup.surface)
  } catch (error) {
    logger.error('Failed to record audit log rollup', {
      error,
      action: rollup.first.params.action,
      entries: rollup.entries,
    })
  }
}
