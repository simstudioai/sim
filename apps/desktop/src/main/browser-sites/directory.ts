import { readFile, stat } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { safeStorage } from 'electron'
import { removeFileIfPresent, writeJsonFileAtomically } from '@/main/atomic-json-file'

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
const MAX_DIRECTORY_FILE_BYTES = 16 * 1024 * 1024
const MAX_DIRECTORY_PAYLOAD_BYTES = 10 * 1024 * 1024
const MAX_SITE_HOSTNAME_LENGTH = 253
const MAX_SITE_NAME_LENGTH = 512
const MAX_SITE_ICON_LENGTH = 512 * 1024
const MAX_SITE_TIMESTAMP_LENGTH = 64
const logger = createLogger('BrowserSiteDirectory')

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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.hostname === 'string' &&
    record.hostname.length > 0 &&
    record.hostname.length <= MAX_SITE_HOSTNAME_LENGTH &&
    (record.name === undefined ||
      (typeof record.name === 'string' && record.name.length <= MAX_SITE_NAME_LENGTH)) &&
    (record.icon === undefined ||
      (typeof record.icon === 'string' && record.icon.length <= MAX_SITE_ICON_LENGTH)) &&
    (record.visits === undefined ||
      (typeof record.visits === 'number' &&
        Number.isSafeInteger(record.visits) &&
        record.visits >= 0)) &&
    (record.importedAt === undefined ||
      (typeof record.importedAt === 'string' &&
        record.importedAt.length <= MAX_SITE_TIMESTAMP_LENGTH &&
        Number.isFinite(Date.parse(record.importedAt))))
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
  private persistenceState: 'unknown' | 'writable' | 'blocked' = 'unknown'
  private mutationTail = Promise.resolve()

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
      return this.persistenceState !== 'blocked' && this.encryption.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private async read(): Promise<SiteRecord[]> {
    if (!this.isAvailable()) return []
    try {
      const metadata = await stat(this.filePath)
      if (!metadata.isFile() || metadata.size > MAX_DIRECTORY_FILE_BYTES) {
        this.blockPersistence('resource-limit')
        return []
      }
      const raw = await readFile(this.filePath)
      const envelope = JSON.parse(raw.toString('utf8')) as EncryptedDirectoryEnvelope
      const isLegacyEnvelope =
        envelope.version === 1 &&
        typeof envelope.payload === 'string' &&
        Object.keys(envelope).length === 2
      if (
        (!isLegacyEnvelope && envelope.version !== DIRECTORY_VERSION) ||
        typeof envelope.payload !== 'string'
      ) {
        this.blockPersistence('invalid-envelope')
        return []
      }
      const decrypted = this.encryption.decryptString(Buffer.from(envelope.payload, 'base64'))
      if (Buffer.byteLength(decrypted, 'utf8') > MAX_DIRECTORY_PAYLOAD_BYTES) {
        this.blockPersistence('resource-limit')
        return []
      }
      const records = JSON.parse(decrypted) as unknown
      if (!Array.isArray(records) || records.length > MAX_SITES || !records.every(isSiteRecord)) {
        this.blockPersistence('invalid-payload')
        return []
      }
      this.persistenceState = 'writable'
      return isLegacyEnvelope ? [] : records
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.persistenceState = 'writable'
        return []
      }
      this.blockPersistence('read-failed')
      return []
    }
  }

  private blockPersistence(
    reason: 'invalid-envelope' | 'invalid-payload' | 'read-failed' | 'resource-limit'
  ): void {
    if (this.persistenceState !== 'blocked') {
      logger.warn('Browser site directory persistence is unavailable', { reason })
    }
    this.persistenceState = 'blocked'
  }

  private async write(records: SiteRecord[]): Promise<boolean> {
    if (!this.isAvailable()) return false
    const payload = JSON.stringify(records)
    if (Buffer.byteLength(payload, 'utf8') > MAX_DIRECTORY_PAYLOAD_BYTES) return false
    const envelope: EncryptedDirectoryEnvelope = {
      version: DIRECTORY_VERSION,
      payload: this.encryption.encryptString(payload).toString('base64'),
    }
    await writeJsonFileAtomically(this.filePath, envelope)
    return true
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
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
  remember(records: readonly SiteRecord[]): Promise<void> {
    if (records.length === 0) return Promise.resolve()
    return this.enqueueMutation(async () => {
      if (!this.isAvailable()) return
      const merged = new Map<string, SiteRecord>()
      for (const existing of await this.read()) merged.set(existing.hostname, existing)
      for (const incoming of records) {
        if (!isSiteRecord(incoming)) continue
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
    })
  }

  /** Forgets every site. Runs with the rest of the browser teardown. */
  clear(): Promise<void> {
    return this.enqueueMutation(async () => {
      await removeFileIfPresent(this.filePath)
      this.persistenceState = 'writable'
    })
  }
}
