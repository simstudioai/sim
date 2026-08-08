import { createHmac } from 'node:crypto'
import { decrypt, encrypt } from '@sim/security/encryption'
import { env } from '@/lib/core/config/env'

const TOKEN_PREFIX = 'sim-v2-chat-v1'
const TOKEN_MAX_LENGTH = 4096

/** Interactive CLI sessions may refresh this rolling expiry on every turn. */
export const V2_CHAT_CONTINUATION_TTL_SECONDS = 24 * 60 * 60

interface ContinuationClaims {
  version: 1
  chatId: string
  workspaceId: string
  authorizationUserId: string
  credentialType: 'personal' | 'workspace'
  readOnly: boolean
  /** Present only when the chat is backed by Sim's persisted chat tables. */
  persistence?: 'sim'
  issuedAt: number
  expiresAt: number
}

export interface ContinuationBinding {
  workspaceId: string
  authorizationUserId: string
  credentialType: 'personal' | 'workspace'
  readOnly: boolean
}

export interface IssueContinuationTokenInput extends ContinuationBinding {
  chatId: string
  persistence?: 'sim'
  /** Unix seconds; exposed only to keep expiry behavior deterministic in tests. */
  now?: number
}

export type VerifiedContinuationToken =
  | { valid: true; chatId: string; persistence?: 'sim' }
  | { valid: false }

function encryptionKey(): Buffer {
  // Derive a dedicated 256-bit key instead of using BETTER_AUTH_SECRET
  // directly. The purpose string prevents ciphertexts from another feature
  // backed by the same deployment secret from being valid here.
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`${TOKEN_PREFIX}:aes-256-gcm-encryption-key`, 'utf8')
    .digest()
}

function decodeCanonicalBase64Url(segment: string): string | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null
  const decoded = Buffer.from(segment, 'base64url')
  return decoded.toString('base64url') === segment ? decoded.toString('utf8') : null
}

function isContinuationClaims(value: unknown): value is ContinuationClaims {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const claims = value as Partial<ContinuationClaims>
  return (
    claims.version === 1 &&
    typeof claims.chatId === 'string' &&
    claims.chatId.length > 0 &&
    claims.chatId.length <= 255 &&
    typeof claims.workspaceId === 'string' &&
    claims.workspaceId.length > 0 &&
    claims.workspaceId.length <= 255 &&
    typeof claims.authorizationUserId === 'string' &&
    claims.authorizationUserId.length > 0 &&
    claims.authorizationUserId.length <= 255 &&
    (claims.credentialType === 'personal' || claims.credentialType === 'workspace') &&
    typeof claims.readOnly === 'boolean' &&
    (claims.persistence === undefined || claims.persistence === 'sim') &&
    Number.isSafeInteger(claims.issuedAt) &&
    Number.isSafeInteger(claims.expiresAt) &&
    (claims.expiresAt as number) > (claims.issuedAt as number)
  )
}

/** Issues an opaque, authenticated handle for one private Mothership chat. */
export async function issueV2ChatContinuationToken(
  input: IssueContinuationTokenInput
): Promise<string> {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000)
  const claims: ContinuationClaims = {
    version: 1,
    chatId: input.chatId,
    workspaceId: input.workspaceId,
    authorizationUserId: input.authorizationUserId,
    credentialType: input.credentialType,
    readOnly: input.readOnly,
    ...(input.persistence ? { persistence: input.persistence } : {}),
    issuedAt,
    expiresAt: issuedAt + V2_CHAT_CONTINUATION_TTL_SECONDS,
  }

  const { encrypted } = await encrypt(JSON.stringify(claims), encryptionKey())
  return `${TOKEN_PREFIX}.${Buffer.from(encrypted, 'utf8').toString('base64url')}`
}

/**
 * Authenticates/decrypts the handle, then verifies expiry and the request's
 * ownership tuple. Every failure is intentionally indistinguishable to callers.
 */
export async function verifyV2ChatContinuationToken(
  token: string,
  binding: ContinuationBinding,
  now: number = Math.floor(Date.now() / 1000)
): Promise<VerifiedContinuationToken> {
  if (!token || token.length > TOKEN_MAX_LENGTH) return { valid: false }

  const [prefix, encodedCiphertext, ...extra] = token.split('.')
  if (prefix !== TOKEN_PREFIX || !encodedCiphertext || extra.length > 0) {
    return { valid: false }
  }

  try {
    const ciphertext = decodeCanonicalBase64Url(encodedCiphertext)
    if (!ciphertext) return { valid: false }
    const { decrypted } = await decrypt(ciphertext, encryptionKey())
    const parsed = JSON.parse(decrypted) as unknown
    if (!isContinuationClaims(parsed)) return { valid: false }
    if (parsed.expiresAt <= now || parsed.issuedAt > now + 60) return { valid: false }
    if (
      parsed.workspaceId !== binding.workspaceId ||
      parsed.authorizationUserId !== binding.authorizationUserId ||
      parsed.credentialType !== binding.credentialType ||
      parsed.readOnly !== binding.readOnly
    ) {
      return { valid: false }
    }
    return {
      valid: true,
      chatId: parsed.chatId,
      ...(parsed.persistence ? { persistence: parsed.persistence } : {}),
    }
  } catch {
    return { valid: false }
  }
}
