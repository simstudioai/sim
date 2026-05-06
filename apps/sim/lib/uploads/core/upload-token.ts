import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { env } from '@/lib/core/config/env'
import type { StorageContext } from '@/lib/uploads/shared/types'

export interface UploadTokenPayload {
  uploadId: string
  key: string
  userId: string
  workspaceId: string
  context: StorageContext
}

interface SignedPayload extends UploadTokenPayload {
  exp: number
  v: 1
}

const toBase64Url = (input: string): string => Buffer.from(input, 'utf8').toString('base64url')

const fromBase64Url = (input: string): string => Buffer.from(input, 'base64url').toString('utf8')

const sign = (payload: string): string => hmacSha256Base64(payload, env.INTERNAL_API_SECRET)

/**
 * Sign an upload session token binding (uploadId, key, userId, workspaceId, context).
 * Used to prevent IDOR on multipart upload follow-up calls (get-part-urls, complete, abort).
 */
export function signUploadToken(payload: UploadTokenPayload, expiresInSeconds = 60 * 60): string {
  const signed: SignedPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    v: 1,
  }
  const encoded = toBase64Url(JSON.stringify(signed))
  return `${encoded}.${sign(encoded)}`
}

export type UploadTokenVerification =
  | { valid: true; payload: UploadTokenPayload }
  | { valid: false }

export function verifyUploadToken(token: string): UploadTokenVerification {
  if (typeof token !== 'string') {
    return { valid: false }
  }
  const parts = token.split('.')
  if (parts.length !== 2) return { valid: false }
  const [encoded, signature] = parts
  if (!encoded || !signature) return { valid: false }

  const expected = sign(encoded)
  if (!safeCompare(signature, expected)) {
    return { valid: false }
  }

  let parsed: SignedPayload
  try {
    parsed = JSON.parse(fromBase64Url(encoded)) as SignedPayload
  } catch {
    return { valid: false }
  }

  if (
    parsed.v !== 1 ||
    typeof parsed.exp !== 'number' ||
    parsed.exp < Math.floor(Date.now() / 1000) ||
    typeof parsed.uploadId !== 'string' ||
    typeof parsed.key !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.workspaceId !== 'string' ||
    typeof parsed.context !== 'string'
  ) {
    return { valid: false }
  }

  return {
    valid: true,
    payload: {
      uploadId: parsed.uploadId,
      key: parsed.key,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      context: parsed.context as StorageContext,
    },
  }
}
