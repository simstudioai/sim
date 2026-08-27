import { open } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { safeStorage } from 'electron'
import { removeFileIfPresent, writeJsonFileAtomically } from '@/main/atomic-json-file'

const STORE_VERSION = 1
const MAX_GRANT_STORE_BYTES = 4 * 1024 * 1024
const MAX_GRANT_PAYLOAD_BYTES = 5 * 512 * 1024
const MAX_PERSISTED_GRANTS = 256
const MAX_GRANT_ID_LENGTH = 128
const MAX_GRANT_NAME_LENGTH = 512
const MAX_GRANT_PATH_LENGTH = 4_096
const MAX_GRANT_BOOKMARK_LENGTH = 256 * 1024
const logger = createLogger('LocalFilesystemGrantStore')

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

class GrantStoreResourceLimitError extends Error {}

async function readGrantStoreFile(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > MAX_GRANT_STORE_BYTES) {
      throw new GrantStoreResourceLimitError()
    }

    const buffer = Buffer.allocUnsafe(metadata.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > metadata.size) throw new GrantStoreResourceLimitError()
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    await handle.close()
  }
}

function isPersistedGrant(value: unknown): value is PersistedLocalFilesystemGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const grant = value as Record<string, unknown>
  return (
    typeof grant.id === 'string' &&
    grant.id.length > 0 &&
    grant.id.length <= MAX_GRANT_ID_LENGTH &&
    typeof grant.name === 'string' &&
    grant.name.length > 0 &&
    grant.name.length <= MAX_GRANT_NAME_LENGTH &&
    typeof grant.rootPath === 'string' &&
    grant.rootPath.length > 0 &&
    grant.rootPath.length <= MAX_GRANT_PATH_LENGTH &&
    !grant.rootPath.includes('\0') &&
    (grant.bookmark === undefined ||
      (typeof grant.bookmark === 'string' &&
        grant.bookmark.length > 0 &&
        grant.bookmark.length <= MAX_GRANT_BOOKMARK_LENGTH))
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
  let state: 'unknown' | 'writable' | 'blocked' = 'unknown'
  let mutationTail = Promise.resolve()

  const enqueueMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(operation)
    mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const blockPersistence = (
    reason: 'invalid-envelope' | 'invalid-payload' | 'read-failed' | 'resource-limit'
  ) => {
    if (state !== 'blocked') {
      logger.warn('Local filesystem grant persistence is unavailable', { reason })
    }
    state = 'blocked'
  }

  const load = async (): Promise<PersistedLocalFilesystemGrant[]> => {
    if (!encryptionAvailable(encryption) || state === 'blocked') return []
    try {
      const raw = JSON.parse(await readGrantStoreFile(filePath)) as Partial<EncryptedGrantEnvelope>
      if (raw.version !== STORE_VERSION || typeof raw.ciphertext !== 'string') {
        blockPersistence('invalid-envelope')
        return []
      }
      const decrypted = encryption.decryptString(Buffer.from(raw.ciphertext, 'base64'))
      if (Buffer.byteLength(decrypted, 'utf8') > MAX_GRANT_PAYLOAD_BYTES) {
        blockPersistence('resource-limit')
        return []
      }
      const parsed = JSON.parse(decrypted) as unknown
      if (
        !Array.isArray(parsed) ||
        parsed.length > MAX_PERSISTED_GRANTS ||
        !parsed.every(isPersistedGrant)
      ) {
        blockPersistence('invalid-payload')
        return []
      }
      state = 'writable'
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        state = 'writable'
        return []
      }
      if (error instanceof GrantStoreResourceLimitError) {
        blockPersistence('resource-limit')
        return []
      }
      blockPersistence('read-failed')
      return []
    }
  }

  return {
    load,

    save(grants) {
      return enqueueMutation(async () => {
        if (!encryptionAvailable(encryption)) return false
        if (state === 'unknown') await load()
        if (state === 'blocked') return false
        if (grants.length > MAX_PERSISTED_GRANTS || !grants.every(isPersistedGrant)) return false
        const payload = JSON.stringify(grants)
        if (Buffer.byteLength(payload, 'utf8') > MAX_GRANT_PAYLOAD_BYTES) return false
        const encrypted = encryption.encryptString(payload)
        const envelope: EncryptedGrantEnvelope = {
          version: STORE_VERSION,
          ciphertext: encrypted.toString('base64'),
        }
        await writeJsonFileAtomically(filePath, envelope)
        return true
      })
    },

    clear() {
      return enqueueMutation(async () => {
        await removeFileIfPresent(filePath)
        state = 'writable'
      })
    },
  }
}
