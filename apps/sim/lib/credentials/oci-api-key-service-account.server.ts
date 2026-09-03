import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { safeCompare } from '@sim/security/compare'
import { eq } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { serviceAccountPrincipalMetadata } from '@/lib/credentials/principal'
import { sendOciRequest } from '@/lib/internal/oci/client.server'
import {
  getOciRegion,
  objectStorageOciDestination,
  resolveEffectiveOciRegion,
} from '@/lib/internal/oci/endpoints'
import { OciRequestError } from '@/lib/internal/oci/errors'
import type { OciSigningCredentials } from '@/lib/internal/oci/signing.server'
import {
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

const MAX_OCID_LENGTH = 255
const MAX_PRIVATE_KEY_BYTES = 64 * 1024
const MAX_PASSPHRASE_BYTES = 4 * 1024
const OCI_VERIFICATION_TIMEOUT_MS = 10_000
const OCI_VERIFICATION_RESPONSE_BYTES = 64 * 1024
const OCID_PATTERN = /^ocid1\.([a-z][a-z0-9_-]*)\.([a-z0-9]+)\.([a-z0-9-]*)\.([a-zA-Z0-9_-]+)$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const PEM_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export interface OciApiKeyCredentialFields {
  tenancyId: string
  userId: string
  fingerprint: string
  privateKey: string
  passphrase?: string
  defaultRegion: string
}

export interface OciApiKeyServiceAccountSecret extends OciSigningCredentials {
  readonly type: typeof OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE
  readonly providerId: typeof OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  readonly defaultRegion: string
  readonly metadata: {
    readonly principalKind: 'user'
    readonly principalId: string
  }
}

export type OciCredentialVerificationCode =
  | 'invalid_credentials'
  | 'invalid_response'
  | 'service_unavailable'

/** Safe error categories for credential verification callers. */
export class OciCredentialVerificationError extends Error {
  constructor(public readonly code: OciCredentialVerificationCode) {
    super(code)
    this.name = 'OciCredentialVerificationError'
  }
}

function assertBoundedText(
  value: unknown,
  field: string,
  maxBytes: number,
  controlPattern = CONTROL_CHARACTER_PATTERN
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maxBytes ||
    controlPattern.test(value)
  ) {
    throw new Error(`OCI ${field} is invalid`)
  }
}

function normalizeOcid(
  value: unknown,
  expectedType: 'tenancy' | 'user'
): {
  value: string
  realmId: string
} {
  assertBoundedText(value, `${expectedType} OCID`, MAX_OCID_LENGTH)
  const normalized = value.trim()
  const match = OCID_PATTERN.exec(normalized)
  if (!match || match[1] !== expectedType) {
    throw new Error(`OCI ${expectedType} OCID has the wrong structure or resource type`)
  }
  return { value: normalized, realmId: match[2] }
}

export function normalizeOciFingerprint(value: unknown): string {
  assertBoundedText(value, 'fingerprint', 128)
  const hex = value.replace(/[:\s]/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('OCI fingerprint must contain 16 MD5 bytes')
  const bytes = hex.match(/.{2}/g)
  if (!bytes) throw new Error('OCI fingerprint must contain 16 MD5 bytes')
  return bytes.join(':')
}

function normalizePrivateKey(value: unknown): string {
  assertBoundedText(value, 'private key', MAX_PRIVATE_KEY_BYTES, PEM_CONTROL_CHARACTER_PATTERN)
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized.startsWith('-----BEGIN ') || !normalized.endsWith('-----')) {
    throw new Error('OCI private key must be PEM encoded')
  }
  return `${normalized}\n`
}

function validatePassphrase(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > MAX_PASSPHRASE_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error('OCI private-key passphrase is invalid')
  }
  return value
}

function validatePrivateKeyAndFingerprint(params: {
  privateKey: string
  passphrase?: string
  fingerprint: string
}): void {
  let key
  try {
    key = createPrivateKey({
      key: params.privateKey,
      format: 'pem',
      ...(params.passphrase !== undefined ? { passphrase: params.passphrase } : {}),
    })
  } catch {
    throw new Error('OCI private key or passphrase is invalid')
  }
  if (key.asymmetricKeyType !== 'rsa') throw new Error('OCI private key must use RSA')
  const modulusLength = key.asymmetricKeyDetails?.modulusLength
  if (modulusLength === undefined || modulusLength < 2048) {
    throw new Error('OCI RSA private key must be at least 2048 bits')
  }
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' })
  const derivedHex = createHash('md5').update(spki).digest('hex')
  const submittedHex = params.fingerprint.replaceAll(':', '')
  const fingerprintsMatch = safeCompare(
    Buffer.from(derivedHex, 'hex').toString('base64'),
    Buffer.from(submittedHex, 'hex').toString('base64')
  )
  if (!fingerprintsMatch) throw new Error('OCI fingerprint does not match the private key')
}

/** Validates and normalizes credential fields without performing I/O. */
export function buildOciApiKeyServiceAccountSecret(
  fields: OciApiKeyCredentialFields
): OciApiKeyServiceAccountSecret {
  const tenancy = normalizeOcid(fields.tenancyId, 'tenancy')
  const user = normalizeOcid(fields.userId, 'user')
  if (tenancy.realmId !== user.realmId)
    throw new Error('OCI tenancy and user OCIDs must share a realm')

  assertBoundedText(fields.defaultRegion, 'default region', 128)
  const defaultRegion = fields.defaultRegion.trim().toLowerCase()
  const region = getOciRegion(defaultRegion)
  if (region.realm.id !== tenancy.realmId) {
    throw new Error('OCI default region must belong to the credential realm')
  }

  const fingerprint = normalizeOciFingerprint(fields.fingerprint)
  const privateKey = normalizePrivateKey(fields.privateKey)
  const passphrase = validatePassphrase(fields.passphrase)
  validatePrivateKeyAndFingerprint({ privateKey, passphrase, fingerprint })
  const metadata = serviceAccountPrincipalMetadata({ kind: 'user', id: user.value })

  return {
    type: OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
    tenancyId: tenancy.value,
    userId: user.value,
    fingerprint,
    privateKey,
    ...(passphrase !== undefined ? { passphrase } : {}),
    defaultRegion,
    metadata: { principalKind: 'user', principalId: metadata.principalId },
  }
}

export function serializeOciApiKeyServiceAccountSecret(
  secret: OciApiKeyServiceAccountSecret
): string {
  return JSON.stringify(secret)
}

function assertExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const keys = Object.keys(record)
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new Error('Stored OCI API-key credential is malformed')
  }
}

/** Strictly parses and revalidates an encrypted OCI credential payload. */
export function parseOciApiKeyServiceAccountSecret(
  serialized: string,
  expectedProviderId: string = OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
): OciApiKeyServiceAccountSecret {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error('Stored OCI API-key credential is malformed')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored OCI API-key credential is malformed')
  }
  const record = parsed as Record<string, unknown>
  assertExactKeys(
    record,
    [
      'type',
      'providerId',
      'tenancyId',
      'userId',
      'fingerprint',
      'privateKey',
      'defaultRegion',
      'metadata',
    ],
    ['passphrase']
  )
  if (
    record.type !== OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE ||
    record.providerId !== expectedProviderId ||
    expectedProviderId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID ||
    !record.metadata ||
    typeof record.metadata !== 'object' ||
    Array.isArray(record.metadata)
  ) {
    throw new Error('Stored OCI API-key credential is malformed')
  }
  const metadata = record.metadata as Record<string, unknown>
  assertExactKeys(metadata, ['principalKind', 'principalId'])
  let passphrase: string | undefined
  if (Object.hasOwn(record, 'passphrase')) {
    if (typeof record.passphrase !== 'string') {
      throw new Error('Stored OCI API-key credential is malformed')
    }
    passphrase = record.passphrase
  }
  if (
    typeof record.tenancyId !== 'string' ||
    typeof record.userId !== 'string' ||
    typeof record.fingerprint !== 'string' ||
    typeof record.privateKey !== 'string' ||
    typeof record.defaultRegion !== 'string'
  ) {
    throw new Error('Stored OCI API-key credential is malformed')
  }
  let rebuilt: OciApiKeyServiceAccountSecret
  try {
    rebuilt = buildOciApiKeyServiceAccountSecret({
      tenancyId: record.tenancyId,
      userId: record.userId,
      fingerprint: record.fingerprint,
      privateKey: record.privateKey,
      ...(passphrase !== undefined ? { passphrase } : {}),
      defaultRegion: record.defaultRegion,
    })
  } catch {
    throw new Error('Stored OCI API-key credential is malformed')
  }
  if (
    metadata.principalKind !== 'user' ||
    metadata.principalId !== rebuilt.userId ||
    record.tenancyId !== rebuilt.tenancyId ||
    record.userId !== rebuilt.userId ||
    record.fingerprint !== rebuilt.fingerprint ||
    record.privateKey !== rebuilt.privateKey ||
    record.defaultRegion !== rebuilt.defaultRegion ||
    record.passphrase !== rebuilt.passphrase
  ) {
    throw new Error('Stored OCI API-key credential is malformed')
  }
  return rebuilt
}

/** Verifies a locally valid credential with Object Storage GetNamespace. */
export async function verifyOciApiKeyCredential(
  secret: OciApiKeyServiceAccountSecret,
  signal?: AbortSignal
): Promise<{ namespace: string }> {
  const region = resolveEffectiveOciRegion(secret.defaultRegion)
  try {
    const result = await sendOciRequest({
      destination: objectStorageOciDestination(region),
      credentials: secret,
      method: 'GET',
      encodedPath: '/n/',
      timeout: OCI_VERIFICATION_TIMEOUT_MS,
      maxResponseBytes: OCI_VERIFICATION_RESPONSE_BYTES,
      signal,
      serviceHeaders: { accept: 'application/json' },
    })
    const parsed: unknown = JSON.parse(await result.response.text())
    if (
      typeof parsed !== 'string' ||
      parsed.length === 0 ||
      Buffer.byteLength(parsed, 'utf8') > 255 ||
      CONTROL_CHARACTER_PATTERN.test(parsed)
    ) {
      throw new OciCredentialVerificationError('invalid_response')
    }
    return { namespace: parsed }
  } catch (error) {
    if (error instanceof OciCredentialVerificationError) throw error
    if (signal?.aborted) throw error
    if (error instanceof OciRequestError && (error.status === 401 || error.status === 403)) {
      throw new OciCredentialVerificationError('invalid_credentials')
    }
    if (error instanceof SyntaxError) {
      throw new OciCredentialVerificationError('invalid_response')
    }
    throw new OciCredentialVerificationError('service_unavailable')
  }
}

/** Validates, verifies, then encrypts an OCI credential in that order. */
export async function verifyAndEncryptOciApiKeyCredential(
  fields: OciApiKeyCredentialFields,
  signal?: AbortSignal
): Promise<{ encryptedServiceAccountKey: string; namespace: string }> {
  const secret = buildOciApiKeyServiceAccountSecret(fields)
  const { namespace } = await verifyOciApiKeyCredential(secret, signal)
  const { encrypted } = await encryptSecret(serializeOciApiKeyServiceAccountSecret(secret))
  return { encryptedServiceAccountKey: encrypted, namespace }
}

interface OciCredentialRowProjection {
  type: string
  providerId: string | null
  encryptedServiceAccountKey: string | null
}

async function findOciCredentialById(
  credentialId: string
): Promise<OciCredentialRowProjection | null> {
  const [row] = await db
    .select({
      type: credential.type,
      providerId: credential.providerId,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)
  return row ?? null
}

/** Loads one provider-bound OCI credential, checking outer binding before decryption. */
export async function loadOciApiKeyCredential(
  credentialId: string
): Promise<OciApiKeyServiceAccountSecret> {
  const row = await findOciCredentialById(credentialId)
  if (
    !row ||
    row.type !== 'service_account' ||
    row.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID ||
    !row.encryptedServiceAccountKey
  ) {
    throw new Error('OCI API-key credential is unavailable or provider-mismatched')
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  return parseOciApiKeyServiceAccountSecret(decrypted, row.providerId)
}
