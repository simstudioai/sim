import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'

/**
 * What the sites brought over from another browser are called, and what they
 * look like.
 *
 * Sim's browser records no history, so it cannot learn on its own that
 * `mail.google.com` is Gmail. This is the answer to that, captured once at
 * import time from the browser that did know, for the hosts being imported
 * anyway. It is a name and an icon per host — never a visit log, never a URL
 * beyond the host itself.
 *
 * Encrypted with the same OS-backed key as the credential vault. The hostnames
 * in here include ones only a saved password knows about, and those live in an
 * encrypted vault today; writing them to a plaintext file beside it would
 * quietly undo that.
 */

/**
 * Bumped when what a record MEANS changes, not merely when a field is added.
 *
 * Version 1 was seeded from the imported cookie hosts, which are mostly ad and
 * analytics origins nobody navigated to. Those records only ever decorated a
 * host the omnibox already had, so they were harmless; version 2 hosts are
 * offered as suggestions in their own right, and carrying the old set forward
 * would put exactly the origins this design rejects into the dropdown. `read`
 * discards a foreign version, so the upgrade costs a re-import — the right
 * trade for a cache of someone else's data that is now user-visible.
 */
const DIRECTORY_VERSION = 2

/**
 * Hosts kept across all imports. Bounded because every record can carry an
 * inline favicon, and the whole directory crosses IPC whenever the browser
 * panel appears. Least-used is evicted first — see {@link evictExcess} for how
 * ties settle.
 */
const MAX_SITES = 500

export interface SiteRecord {
  hostname: string
  /** What the source browser's page titles call this site. */
  name?: string
  /** The source browser's favicon, as a `data:` URL. */
  icon?: string
  /**
   * How much the site was used in the browser it came from. Present only for
   * hosts an import found in the source browser's history; absent for one known
   * solely through a saved password.
   *
   * An aggregate, deliberately: no visit times, no URLs, no ordering of one
   * visit against another. Enough to rank suggestions, not enough to
   * reconstruct where someone went or when.
   */
  visits?: number
  /**
   * When Sim imported this host — wall clock at import, never the source
   * browser's own last-visit time, which would be the visit log this store
   * exists to avoid keeping.
   */
  importedAt?: string
}

interface EncryptedDirectoryEnvelope {
  version: number
  payload: string
}

function isSiteRecord(value: unknown): value is SiteRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SiteRecord).hostname === 'string' &&
    (value as SiteRecord).hostname !== ''
  )
}

function maxDefined(first: number | undefined, second: number | undefined): number | undefined {
  if (first === undefined) return second
  if (second === undefined) return first
  return Math.max(first, second)
}

/**
 * Trims the directory to {@link MAX_SITES}, dropping the least-used first and
 * breaking ties by most recent import, then alphabetically so the same inputs
 * always evict the same records.
 *
 * A record with no visit count is a record with no evidence of use, so it goes
 * first rather than last — that is the only reading under which eviction order
 * cannot be gamed by a malformed entry.
 */
function evictExcess(records: SiteRecord[]): SiteRecord[] {
  if (records.length <= MAX_SITES) return records
  return [...records]
    .sort(
      (a, b) =>
        (b.visits ?? 0) - (a.visits ?? 0) ||
        (b.importedAt ?? '').localeCompare(a.importedAt ?? '') ||
        a.hostname.localeCompare(b.hostname)
    )
    .slice(0, MAX_SITES)
}

interface EncryptionProvider {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class SiteDirectory {
  constructor(
    private readonly filePath: string,
    private readonly encryption: EncryptionProvider = safeStorage
  ) {}

  /**
   * Whether this device can store the directory at all. Without OS-backed
   * encryption nothing is written, matching the vault: a site list is not
   * worth leaving in plaintext for the next person on this machine.
   */
  isAvailable(): boolean {
    try {
      return this.encryption.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private async read(): Promise<SiteRecord[]> {
    if (!this.isAvailable()) return []
    try {
      const raw = await readFile(this.filePath)
      const envelope = JSON.parse(raw.toString('utf8')) as EncryptedDirectoryEnvelope
      if (envelope.version !== DIRECTORY_VERSION) return []
      const decrypted = this.encryption.decryptString(Buffer.from(envelope.payload, 'base64'))
      const records = JSON.parse(decrypted) as SiteRecord[]
      // Per-record, not just per-array: everything downstream sorts and merges
      // on `hostname`, so one entry without it is a TypeError in the middle of
      // an import rather than a record that is quietly skipped.
      return Array.isArray(records) ? records.filter(isSiteRecord) : []
    } catch {
      // A missing, truncated, or foreign-keyed file reads as empty rather than
      // taking the omnibox down with it.
      return []
    }
  }

  private async write(records: SiteRecord[]): Promise<boolean> {
    if (!this.isAvailable()) return false
    const envelope: EncryptedDirectoryEnvelope = {
      version: DIRECTORY_VERSION,
      payload: this.encryption.encryptString(JSON.stringify(records)).toString('base64'),
    }
    await mkdir(dirname(this.filePath), { recursive: true })
    // Temporary file then rename, so a crash mid-write cannot leave a
    // half-written directory behind.
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(envelope), { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
    return true
  }

  async list(): Promise<SiteRecord[]> {
    return this.read()
  }

  /**
   * Records what an import learned, keeping anything it did not.
   *
   * A re-import refreshes a site that has been renamed or re-iconed, but an
   * entry the new import says nothing about is left alone rather than blanked:
   * importing a second profile should add to what the browser knows, not
   * strip the first profile's sites of their names.
   */
  async remember(records: readonly SiteRecord[]): Promise<void> {
    if (records.length === 0 || !this.isAvailable()) return
    const merged = new Map<string, SiteRecord>()
    for (const existing of await this.read()) merged.set(existing.hostname, existing)
    for (const incoming of records) {
      if (!incoming.hostname) continue
      const existing = merged.get(incoming.hostname)
      merged.set(incoming.hostname, {
        hostname: incoming.hostname,
        name: incoming.name ?? existing?.name,
        icon: incoming.icon ?? existing?.icon,
        // The most-used of the profiles a host was seen in wins, so re-importing
        // a profile that barely touches a site cannot demote it.
        visits: maxDefined(incoming.visits, existing?.visits),
        importedAt: incoming.importedAt ?? existing?.importedAt,
      })
    }
    await this.write(evictExcess([...merged.values()]))
  }

  /** Forgets every site. Runs with the rest of the browser teardown. */
  async clear(): Promise<void> {
    try {
      await unlink(this.filePath)
    } catch {
      // Already gone is the desired state.
    }
  }
}
