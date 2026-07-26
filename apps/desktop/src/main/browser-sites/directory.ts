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

const DIRECTORY_VERSION = 1

export interface SiteRecord {
  hostname: string
  /** What the source browser's page titles call this site. */
  name?: string
  /** The source browser's favicon, as a `data:` URL. */
  icon?: string
}

interface EncryptedDirectoryEnvelope {
  version: number
  payload: string
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
      return Array.isArray(records) ? records : []
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
      })
    }
    await this.write([...merged.values()])
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
