import { readFile } from 'node:fs/promises'
import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import { generateId } from '@sim/utils/id'
import { safeStorage } from 'electron'
import { removeFileIfPresent, writeJsonFileAtomically } from '@/main/atomic-json-file'
import { normalizeOrigin, normalizeUsername } from '@/main/browser-credentials/origin'

/**
 * The encrypted credential store.
 *
 * The whole record set is encrypted as one blob with Electron `safeStorage`
 * (Keychain on macOS), written atomically with restrictive permissions. There
 * is no plaintext fallback: when OS-backed encryption is unavailable the vault
 * reports itself unavailable and refuses to store anything, because a password
 * file Sim cannot encrypt is worse than a feature the user does not get.
 *
 * Records are decrypted per operation rather than cached. The data is small and
 * local, and not holding a decrypted password list in memory for the life of
 * the process is worth far more than the saved microseconds.
 */

const VAULT_VERSION = 1

export interface CredentialRecord {
  id: string
  origin: string
  username: string
  password: string
  /** The site's own icon as a `data:` URL, copied from the source browser. */
  icon?: string
  createdAt: string
  updatedAt: string
  source: 'chrome' | 'manual'
}

/** How an import should treat a credential that already exists. */
export type ConflictPolicy = 'keep-existing' | 'replace'

export interface ImportCandidate {
  origin: string
  username: string
  password: string
  icon?: string
}

export interface ImportOutcome {
  added: number
  updated: number
  skipped: number
}

interface EncryptedVaultEnvelope {
  version: typeof VAULT_VERSION
  ciphertext: string
}

interface EncryptionProvider {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

function isCredentialRecord(value: unknown): value is CredentialRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.origin === 'string' &&
    typeof record.username === 'string' &&
    typeof record.password === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    (record.source === 'chrome' || record.source === 'manual')
  )
}

function toMetadata(record: CredentialRecord): BrowserCredentialMetadata {
  return {
    id: record.id,
    origin: record.origin,
    username: record.username,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: record.source,
    ...(record.icon ? { icon: record.icon } : {}),
  }
}

export class CredentialVault {
  constructor(
    private readonly filePath: string,
    private readonly encryption: EncryptionProvider = safeStorage,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Whether credentials can be stored at all. The UI must hide or disable
   * password features when this is false rather than degrading to plaintext.
   */
  isAvailable(): boolean {
    // Guarded: on a Linux box with no keyring this throws rather than
    // returning false, and an unguarded call propagated out of a password
    // import. The site directory has always defended against it; this did not.
    try {
      return this.encryption.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /**
   * Decrypted records. Private on purpose — nothing outside this class should
   * hold a list of passwords, and callers get metadata instead.
   */
  private async read(): Promise<CredentialRecord[]> {
    if (!this.isAvailable()) return []
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as
        | Partial<EncryptedVaultEnvelope>
        | undefined
      if (raw?.version !== VAULT_VERSION || typeof raw.ciphertext !== 'string') return []
      const parsed = JSON.parse(
        this.encryption.decryptString(Buffer.from(raw.ciphertext, 'base64'))
      ) as unknown
      return Array.isArray(parsed) ? parsed.filter(isCredentialRecord) : []
    } catch {
      // A missing, corrupt, or undecryptable vault reads as empty rather than
      // throwing: the browser must stay usable, and a failed write is where
      // the user is told something is wrong.
      return []
    }
  }

  private async write(records: CredentialRecord[]): Promise<boolean> {
    if (!this.isAvailable()) return false
    const envelope: EncryptedVaultEnvelope = {
      version: VAULT_VERSION,
      ciphertext: this.encryption.encryptString(JSON.stringify(records)).toString('base64'),
    }
    await writeJsonFileAtomically(this.filePath, envelope)
    return true
  }

  /** Every stored credential, without passwords, newest activity first. */
  async list(): Promise<BrowserCredentialMetadata[]> {
    const records = await this.read()
    return records
      .map(toMetadata)
      .sort(
        (left, right) =>
          left.origin.localeCompare(right.origin) || left.username.localeCompare(right.username)
      )
  }

  /** Credentials whose origin exactly matches `origin`, without passwords. */
  async listForOrigin(origin: string): Promise<BrowserCredentialMetadata[]> {
    const normalized = normalizeOrigin(origin)
    if (normalized === null) return []
    return (await this.read())
      .filter((record) => record.origin === normalized)
      .map(toMetadata)
      .sort((left, right) => left.username.localeCompare(right.username))
  }

  /**
   * The username and password for one credential.
   *
   * Main-process only, and only for an authorized fill. These values must
   * never be returned through the preload bridge, written to a log, put on a
   * span, or persisted anywhere outside this vault.
   */
  async readForFill(
    id: string,
    origin: string
  ): Promise<{ username: string; password: string } | null> {
    const normalized = normalizeOrigin(origin)
    if (normalized === null) return null
    // The origin is re-checked here, at the last moment before plaintext is
    // produced, so a stale or swapped id cannot pull a password for a site
    // other than the one the fill was authorized against.
    const record = (await this.read()).find(
      (candidate) => candidate.id === id && candidate.origin === normalized
    )
    return record ? { username: record.username, password: record.password } : null
  }

  /**
   * The password for one credential, by id alone.
   *
   * Unlike {@link readForFill} there is no origin to check against, because
   * the password manager lists credentials rather than matching a page. That
   * makes this the weakest-guarded read in the vault, so its only caller must
   * be the reveal path, behind OS authentication.
   */
  async revealPassword(id: string): Promise<string | null> {
    return (await this.read()).find((record) => record.id === id)?.password ?? null
  }

  async delete(id: string): Promise<boolean> {
    const records = await this.read()
    const remaining = records.filter((record) => record.id !== id)
    if (remaining.length === records.length) return false
    return this.write(remaining)
  }

  /**
   * Merges imported credentials.
   *
   * Identity is exact origin plus username, per the import design: the same
   * login on the same site is the same credential, and everything else is a
   * new one. A conflicting entry is kept or replaced according to `policy` —
   * never silently duplicated.
   */
  async importCredentials(
    candidates: ImportCandidate[],
    policy: ConflictPolicy
  ): Promise<ImportOutcome> {
    if (!this.isAvailable()) return { added: 0, updated: 0, skipped: candidates.length }

    const records = await this.read()
    const byIdentity = new Map(
      records.map((record) => [`${record.origin}\u0000${record.username}`, record])
    )
    const timestamp = this.now().toISOString()
    const outcome: ImportOutcome = { added: 0, updated: 0, skipped: 0 }
    let iconsAdded = false

    for (const candidate of candidates) {
      const origin = normalizeOrigin(candidate.origin)
      const username = normalizeUsername(candidate.username)
      if (origin === null || candidate.password.length === 0) {
        outcome.skipped += 1
        continue
      }

      const identity = `${origin}\u0000${username}`
      const existing = byIdentity.get(identity)
      if (existing) {
        if (policy === 'keep-existing' || existing.password === candidate.password) {
          // A re-import still refreshes a missing icon; that is not a
          // credential change, so it does not count as an update.
          if (candidate.icon && !existing.icon) {
            existing.icon = candidate.icon
            iconsAdded = true
          }
          outcome.skipped += 1
          continue
        }
        existing.password = candidate.password
        existing.updatedAt = timestamp
        existing.source = 'chrome'
        if (candidate.icon) existing.icon = candidate.icon
        outcome.updated += 1
        continue
      }

      const record: CredentialRecord = {
        id: generateId(),
        origin,
        username,
        password: candidate.password,
        ...(candidate.icon ? { icon: candidate.icon } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        source: 'chrome',
      }
      byIdentity.set(identity, record)
      records.push(record)
      outcome.added += 1
    }

    if (outcome.added === 0 && outcome.updated === 0 && !iconsAdded) return outcome
    if (!(await this.write(records))) {
      return { added: 0, updated: 0, skipped: candidates.length }
    }
    return outcome
  }

  /**
   * Destroys the vault. Sign-out runs this so the next Sim account on this
   * machine cannot inherit the previous user's passwords.
   */
  async clear(): Promise<void> {
    await removeFileIfPresent(this.filePath)
  }
}
