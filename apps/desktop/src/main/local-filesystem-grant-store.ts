import { readFile } from 'node:fs/promises'
import { safeStorage } from 'electron'
import { removeFileIfPresent, writeJsonFileAtomically } from '@/main/atomic-json-file'

const STORE_VERSION = 1

export interface PersistedLocalFilesystemGrant {
  id: string
  name: string
  rootPath: string
  bookmark?: string
}

export interface LocalFilesystemGrantStore {
  load(): Promise<PersistedLocalFilesystemGrant[]>
  save(grants: PersistedLocalFilesystemGrant[]): Promise<boolean>
  clear(): Promise<void>
}

interface EncryptionProvider {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface EncryptedGrantEnvelope {
  version: typeof STORE_VERSION
  ciphertext: string
}

function isPersistedGrant(value: unknown): value is PersistedLocalFilesystemGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const grant = value as Record<string, unknown>
  return (
    typeof grant.id === 'string' &&
    typeof grant.name === 'string' &&
    typeof grant.rootPath === 'string' &&
    (grant.bookmark === undefined || typeof grant.bookmark === 'string')
  )
}

/**
 * `safeStorage.isEncryptionAvailable()` throws rather than returning false on a
 * Linux box with no keyring, and an unguarded call propagated out of grant
 * persistence. Grants stay session-only when encryption is unavailable.
 */
function encryptionAvailable(encryption: EncryptionProvider): boolean {
  try {
    return encryption.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Stores host paths and optional macOS security-scoped bookmarks encrypted
 * with Electron safeStorage (Keychain on macOS, DPAPI on Windows, and the
 * desktop keyring on supported Linux environments). No plaintext fallback is
 * used: when OS-backed encryption is unavailable, grants remain session-only.
 */
export function createEncryptedLocalFilesystemGrantStore(
  filePath: string,
  encryption: EncryptionProvider = safeStorage
): LocalFilesystemGrantStore {
  return {
    async load() {
      if (!encryptionAvailable(encryption)) return []
      try {
        const raw = JSON.parse(await readFile(filePath, 'utf8')) as Partial<EncryptedGrantEnvelope>
        if (raw.version !== STORE_VERSION || typeof raw.ciphertext !== 'string') return []
        const decrypted = encryption.decryptString(Buffer.from(raw.ciphertext, 'base64'))
        const parsed = JSON.parse(decrypted) as unknown
        return Array.isArray(parsed) ? parsed.filter(isPersistedGrant) : []
      } catch {
        return []
      }
    },

    async save(grants) {
      if (!encryptionAvailable(encryption)) return false
      const encrypted = encryption.encryptString(JSON.stringify(grants))
      const envelope: EncryptedGrantEnvelope = {
        version: STORE_VERSION,
        ciphertext: encrypted.toString('base64'),
      }
      await writeJsonFileAtomically(filePath, envelope)
      return true
    },

    async clear() {
      await removeFileIfPresent(filePath)
    },
  }
}
