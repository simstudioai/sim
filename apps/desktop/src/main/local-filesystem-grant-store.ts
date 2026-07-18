import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'

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

async function removeFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      (error as { code?: unknown }).code !== 'ENOENT'
    ) {
      throw error
    }
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
      if (!encryption.isEncryptionAvailable()) return []
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
      if (!encryption.isEncryptionAvailable()) return false
      const encrypted = encryption.encryptString(JSON.stringify(grants))
      const envelope: EncryptedGrantEnvelope = {
        version: STORE_VERSION,
        ciphertext: encrypted.toString('base64'),
      }
      await mkdir(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${process.pid}.tmp`
      await writeFile(temporaryPath, JSON.stringify(envelope), { mode: 0o600 })
      await rename(temporaryPath, filePath)
      return true
    },

    async clear() {
      await removeFile(filePath)
    },
  }
}
