import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { safeCompare } from '@sim/security/compare'
import { encryptSecret } from '@/lib/core/security/encryption'
import { serviceAccountPrincipalMetadata } from '@/lib/credentials/principal'
import { verifyOciApiKeyCredentialForSetup } from '@/lib/internal/oci/client.server'
import { getOciRegion } from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

const MAX_OCID_LENGTH = 255
const MAX_PRIVATE_KEY_BYTES = 64 * 1024
const MAX_PASSPHRASE_BYTES = 4 * 1024
const OCID_PATTERN = /^ocid1\.([a-z][a-z0-9_-]*)\.([a-z0-9]+)\.([a-z0-9-]*)\.([a-zA-Z0-9_-]+)$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const PEM_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export interface OciApiKeyCredentialFields {
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  privateKey: string
  privateKeyPassphrase?: string
  region: string
}

interface OciApiKeyServiceAccountSecret {
  readonly type: typeof OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE
  readonly providerId: typeof OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  readonly tenancyOcid: string
  readonly userOcid: string
  readonly fingerprint: string
  readonly privateKey: string
  readonly privateKeyPassphrase?: string
  readonly region: string
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
): { value: string; realmId: string } {
  assertBoundedText(value, `${expectedType} OCID`, MAX_OCID_LENGTH)
  const normalized = value.trim()
  const match = OCID_PATTERN.exec(normalized)
  if (!match || match[1] !== expectedType) {
    throw new Error(`OCI ${expectedType} OCID has the wrong structure or resource type`)
  }
  return { value: normalized, realmId: match[2] }
}

function normalizeFingerprint(value: unknown): string {
  assertBoundedText(value, 'fingerprint', 128)
  const hex = value.replace(/[:\s]/g, '').toLowerCase()
  const bytes = /^[0-9a-f]{32}$/.test(hex) ? hex.match(/.{2}/g) : null
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

function buildSecret(fields: OciApiKeyCredentialFields): OciApiKeyServiceAccountSecret {
  const tenancy = normalizeOcid(fields.tenancyOcid, 'tenancy')
  const user = normalizeOcid(fields.userOcid, 'user')
  if (tenancy.realmId !== user.realmId) {
    throw new Error('OCI tenancy and user OCIDs must share a realm')
  }
  assertBoundedText(fields.region, 'region', 128)
  const region = getOciRegion(fields.region)
  if (region.realm.id !== tenancy.realmId) {
    throw new Error('OCI region must belong to the credential realm')
  }
  const fingerprint = normalizeFingerprint(fields.fingerprint)
  const privateKey = normalizePrivateKey(fields.privateKey)
  const privateKeyPassphrase = validatePassphrase(fields.privateKeyPassphrase)

  let key
  try {
    key = createPrivateKey({
      key: privateKey,
      format: 'pem',
      ...(privateKeyPassphrase !== undefined ? { passphrase: privateKeyPassphrase } : {}),
    })
  } catch {
    throw new Error('OCI private key or passphrase is invalid')
  }
  if (key.asymmetricKeyType !== 'rsa') throw new Error('OCI private key must use RSA')
  if (
    key.asymmetricKeyDetails?.modulusLength === undefined ||
    key.asymmetricKeyDetails.modulusLength < 2048
  ) {
    throw new Error('OCI RSA private key must be at least 2048 bits')
  }
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' })
  const derived = createHash('md5').update(spki).digest().toString('base64')
  const submitted = Buffer.from(fingerprint.replaceAll(':', ''), 'hex').toString('base64')
  if (!safeCompare(derived, submitted)) {
    throw new Error('OCI fingerprint does not match the private key')
  }

  const metadata = serviceAccountPrincipalMetadata({ kind: 'user', id: user.value })
  return {
    type: OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
    tenancyOcid: tenancy.value,
    userOcid: user.value,
    fingerprint,
    privateKey,
    ...(privateKeyPassphrase !== undefined ? { privateKeyPassphrase } : {}),
    region: region.id,
    metadata: { principalKind: 'user', principalId: metadata.principalId },
  }
}

/** Validates, verifies with GetNamespace, and only then encrypts an OCI credential. */
export async function verifyAndEncryptOciApiKeyCredential(
  fields: OciApiKeyCredentialFields,
  signal?: AbortSignal
): Promise<{ encryptedServiceAccountKey: string; userOcid: string }> {
  let secret: OciApiKeyServiceAccountSecret
  try {
    secret = buildSecret(fields)
  } catch {
    throw new OciCredentialVerificationError('invalid_credentials')
  }
  let responseBody: Uint8Array
  try {
    responseBody = await verifyOciApiKeyCredentialForSetup(JSON.stringify(secret), signal)
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof OciClientError && (error.status === 401 || error.status === 403)) {
      throw new OciCredentialVerificationError('invalid_credentials')
    }
    throw new OciCredentialVerificationError('service_unavailable')
  }
  try {
    const namespace: unknown = JSON.parse(Buffer.from(responseBody).toString('utf8'))
    if (
      typeof namespace !== 'string' ||
      namespace.length === 0 ||
      Buffer.byteLength(namespace, 'utf8') > 255 ||
      CONTROL_CHARACTER_PATTERN.test(namespace)
    ) {
      throw new Error('invalid namespace')
    }
  } catch {
    throw new OciCredentialVerificationError('invalid_response')
  }
  const { encrypted } = await encryptSecret(JSON.stringify(secret))
  return { encryptedServiceAccountKey: encrypted, userOcid: secret.userOcid }
}
