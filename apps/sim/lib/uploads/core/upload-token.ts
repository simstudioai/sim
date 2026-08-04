import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { env } from '@/lib/core/config/env'

export type UploadSessionPurpose =
  | 'workspace_file'
  | 'table_import'
  | 'knowledge_document'
  | 'profile_picture'
  | 'workspace_logo'
  | 'mothership_attachment'
  | 'execution_attachment'

export type UploadStorageProvider = 's3' | 'blob' | 'gcs' | 'local'
export type UploadTransferMethod = 'put' | 'multipart'

type UploadPurposeScope =
  | {
      purpose: 'workspace_file'
      workspaceId: string
      context: 'workspace'
    }
  | {
      purpose: 'table_import'
      workspaceId: string
      context: 'table-import'
    }
  | {
      purpose: 'knowledge_document'
      workspaceId: string
      context: 'knowledge-base'
      knowledgeBaseId: string
    }
  | {
      purpose: 'profile_picture'
      workspaceId: null
      context: 'profile-pictures'
    }
  | {
      purpose: 'workspace_logo'
      workspaceId: string
      context: 'workspace-logos'
    }
  | {
      purpose: 'mothership_attachment'
      workspaceId: string
      context: 'mothership'
    }
  | {
      purpose: 'execution_attachment'
      workspaceId: string
      context: 'execution'
      workflowId: string
      executionId: string
    }

type UploadTransferState =
  | {
      method: 'put'
      providerUploadId: null
    }
  | {
      method: 'multipart'
      providerUploadId: string | null
      partSize: number
      partCount: number
    }

interface UploadTokenBase {
  uploadId: string
  actorId: string
  finalKey: string
  stagingKey: string
  provider: UploadStorageProvider
  fileName: string
  contentType: string
  fileSize: number
  metadata: Record<string, unknown>
  createdAt: string
  expiresAt: string
}

export type UploadTokenPayload = UploadTokenBase & UploadPurposeScope & UploadTransferState

type SignedPayload = UploadTokenPayload & {
  exp: number
  v: 2
}

const BASE_KEYS = [
  'uploadId',
  'actorId',
  'finalKey',
  'stagingKey',
  'provider',
  'providerUploadId',
  'method',
  'purpose',
  'workspaceId',
  'context',
  'fileName',
  'contentType',
  'fileSize',
  'metadata',
  'createdAt',
  'expiresAt',
  'exp',
  'v',
] as const

const toBase64Url = (input: string): string => Buffer.from(input, 'utf8').toString('base64url')

const fromBase64Url = (input: string): string => Buffer.from(input, 'base64url').toString('utf8')

const sign = (payload: string): string => hmacSha256Base64(payload, env.INTERNAL_API_SECRET)

/**
 * Signs the complete, immutable state of one upload session.
 *
 * Version 2 intentionally has no compatibility parser for legacy multipart tokens. A token must
 * carry a purpose-specific scope, transfer method, staging and final keys, provider state, exact
 * object identity, and one canonical expiry.
 */
export function signUploadToken(payload: UploadTokenPayload): string {
  assertUploadTokenPayload(payload)
  const expiresAt = new Date(payload.expiresAt)
  const signed: SignedPayload = {
    ...payload,
    exp: Math.floor(expiresAt.getTime() / 1000),
    v: 2,
  }
  const encoded = toBase64Url(JSON.stringify(signed))
  return `${encoded}.${sign(encoded)}`
}

export type UploadTokenVerification =
  | { valid: true; payload: UploadTokenPayload }
  | { valid: false }

export function verifyUploadToken(token: string): UploadTokenVerification {
  if (typeof token !== 'string') return { valid: false }
  const parts = token.split('.')
  if (parts.length !== 2) return { valid: false }
  const [encoded, signature] = parts
  if (!encoded || !signature || !safeCompare(signature, sign(encoded))) return { valid: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(encoded))
  } catch {
    return { valid: false }
  }

  if (!isRecord(parsed) || parsed.v !== 2 || !isSafePositiveInteger(parsed.exp)) {
    return { valid: false }
  }
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return { valid: false }

  try {
    assertUploadTokenPayload(parsed)
  } catch {
    return { valid: false }
  }

  if (Math.floor(new Date(parsed.expiresAt).getTime() / 1000) !== parsed.exp) {
    return { valid: false }
  }

  const { exp: _exp, v: _version, ...payload } = parsed
  return { valid: true, payload }
}

function assertUploadTokenPayload(value: unknown): asserts value is UploadTokenPayload {
  if (!isRecord(value)) throw new Error('Upload token payload must be an object')

  const purposeKeys =
    value.purpose === 'knowledge_document'
      ? ['knowledgeBaseId']
      : value.purpose === 'execution_attachment'
        ? ['workflowId', 'executionId']
        : []
  const methodKeys = value.method === 'multipart' ? ['partSize', 'partCount'] : []
  const allowedKeys = new Set<string>([...BASE_KEYS, ...purposeKeys, ...methodKeys])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error('Upload token payload contains unexpected state')
  }

  if (
    !isNonEmptyString(value.uploadId) ||
    !isNonEmptyString(value.actorId) ||
    !isNonEmptyString(value.finalKey) ||
    !isNonEmptyString(value.stagingKey) ||
    value.finalKey === value.stagingKey ||
    !value.stagingKey.startsWith(`upload-sessions/${value.uploadId}/`) ||
    !isNonEmptyString(value.fileName) ||
    !isNonEmptyString(value.contentType) ||
    !isSafePositiveInteger(value.fileSize) ||
    !isPlainRecord(value.metadata)
  ) {
    throw new Error('Upload token payload has invalid object state')
  }

  if (
    value.provider !== 's3' &&
    value.provider !== 'blob' &&
    value.provider !== 'gcs' &&
    value.provider !== 'local'
  ) {
    throw new Error('Upload token payload has an invalid provider')
  }

  if (value.method === 'put') {
    if (value.providerUploadId !== null || 'partSize' in value || 'partCount' in value) {
      throw new Error('PUT upload token has multipart state')
    }
  } else if (value.method === 'multipart') {
    if (!isSafePositiveInteger(value.partSize) || !isSafePositiveInteger(value.partCount)) {
      throw new Error('Multipart upload token has invalid geometry')
    }
    if (value.provider === 'local') {
      if (value.providerUploadId !== null) {
        throw new Error('Local multipart upload token has a provider upload id')
      }
    } else if (!isNonEmptyString(value.providerUploadId)) {
      throw new Error('Cloud multipart upload token is missing its provider upload id')
    }
  } else {
    throw new Error('Upload token payload has an invalid transfer method')
  }

  assertPurposeScope(value)

  if (!isNonEmptyString(value.createdAt) || !isNonEmptyString(value.expiresAt)) {
    throw new Error('Upload token payload is missing timestamps')
  }
  const createdAt = new Date(value.createdAt).getTime()
  const expiresAt = new Date(value.expiresAt).getTime()
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    throw new Error('Upload token payload has invalid timestamps')
  }
}

function assertPurposeScope(value: Record<string, unknown>): void {
  switch (value.purpose) {
    case 'workspace_file':
      assertWorkspacePurpose(value, 'workspace')
      break
    case 'table_import':
      assertWorkspacePurpose(value, 'table-import')
      break
    case 'knowledge_document':
      assertWorkspacePurpose(value, 'knowledge-base')
      if (!isNonEmptyString(value.knowledgeBaseId)) {
        throw new Error('Knowledge upload token is missing knowledgeBaseId')
      }
      break
    case 'profile_picture':
      if (value.workspaceId !== null || value.context !== 'profile-pictures') {
        throw new Error('Profile-picture upload token has invalid scope')
      }
      break
    case 'workspace_logo':
      assertWorkspacePurpose(value, 'workspace-logos')
      break
    case 'mothership_attachment':
      assertWorkspacePurpose(value, 'mothership')
      break
    case 'execution_attachment':
      assertWorkspacePurpose(value, 'execution')
      if (!isNonEmptyString(value.workflowId) || !isNonEmptyString(value.executionId)) {
        throw new Error('Execution upload token is missing workflow scope')
      }
      break
    default:
      throw new Error('Upload token payload has an invalid purpose')
  }
}

function assertWorkspacePurpose(value: Record<string, unknown>, context: string): void {
  if (!isNonEmptyString(value.workspaceId) || value.context !== context) {
    throw new Error('Upload token payload has invalid workspace scope')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
