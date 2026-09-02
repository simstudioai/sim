import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { decryptSecret } from '@/lib/core/security/encryption'
import { DISPLAY_NAME_MAX_LENGTH } from '@/lib/credentials/display-name'
import {
  normalizeOciCommercialRegion,
  normalizeOciNamespace,
  type OciObjectStorageConnectionConfig,
  sendOciListBuckets,
  withOciObjectStorageClient,
} from '@/lib/internal/oci-object-storage/client'
import {
  OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

export interface OciObjectStorageSecret extends OciObjectStorageConnectionConfig {
  type: typeof OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_SECRET_TYPE
  providerId: typeof OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID
  ownerId: string
  ownerDisplayName?: string
}

export interface OciObjectStorageCredentialFields {
  accessKeyId: string
  secretAccessKey: string
  namespace: string
  region: string
}

export function ociObjectStorageCredentialDisplayName(input: {
  ownerDisplayName?: string
  namespace: string
  region: string
}): string {
  return `${input.ownerDisplayName || input.namespace} — ${input.region}`.slice(
    0,
    DISPLAY_NAME_MAX_LENGTH
  )
}

const storedSecretSchema = z
  .object({
    type: z.literal(OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_SECRET_TYPE),
    providerId: z.literal(OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID),
    accessKeyId: z.string().min(1).max(512),
    secretAccessKey: z.string().min(1).max(1_024),
    namespace: z.string().min(1).max(63),
    region: z.string().min(1).max(64),
    ownerId: z.string().min(1).max(1_024),
    ownerDisplayName: z.string().min(1).max(512).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export class OciObjectStorageCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OciObjectStorageCredentialError'
  }
}

export function normalizeOciObjectStorageCredentialFields(
  fields: OciObjectStorageCredentialFields
): OciObjectStorageCredentialFields {
  const accessKeyId = fields.accessKeyId.trim()
  const secretAccessKey = fields.secretAccessKey.trim()
  if (!accessKeyId || accessKeyId.length > 512) {
    throw new OciObjectStorageCredentialError('OCI Access Key must be between 1 and 512 characters')
  }
  if (!secretAccessKey || secretAccessKey.length > 1_024) {
    throw new OciObjectStorageCredentialError(
      'OCI Secret Key must be between 1 and 1024 characters'
    )
  }
  try {
    return {
      accessKeyId,
      secretAccessKey,
      namespace: normalizeOciNamespace(fields.namespace),
      region: normalizeOciCommercialRegion(fields.region),
    }
  } catch (error) {
    throw new OciObjectStorageCredentialError(
      error instanceof Error ? error.message : 'Invalid OCI namespace or region'
    )
  }
}

export async function validateOciObjectStorageServiceAccount(
  fields: OciObjectStorageCredentialFields,
  signal?: AbortSignal
): Promise<{
  secret: OciObjectStorageCredentialFields
  ownerId: string
  ownerDisplayName?: string
}> {
  const secret = normalizeOciObjectStorageCredentialFields(fields)
  try {
    const response = await withOciObjectStorageClient(secret, 3, (client) =>
      sendOciListBuckets(client, signal)
    )
    const ownerId = response.Owner?.ID?.trim()
    if (!ownerId) {
      throw new OciObjectStorageCredentialError(
        'Oracle Object Storage returned an invalid account identity'
      )
    }
    const ownerDisplayName = response.Owner?.DisplayName?.trim()
    return { secret, ownerId, ...(ownerDisplayName ? { ownerDisplayName } : {}) }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OciObjectStorageCredentialError) throw error
    throw new OciObjectStorageCredentialError(
      'Could not verify the OCI Customer Secret Key, namespace, and region'
    )
  }
}

/** Loads and provider-binds an encrypted OCI Object Storage credential. */
export async function getOciObjectStorageServiceAccountSecret(
  credentialId: string
): Promise<OciObjectStorageSecret> {
  const [row] = await db
    .select({
      type: credential.type,
      providerId: credential.providerId,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (
    !row ||
    row.type !== 'service_account' ||
    row.providerId !== OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID ||
    !row.encryptedServiceAccountKey
  ) {
    throw new OciObjectStorageCredentialError('OCI Object Storage credential not found')
  }

  try {
    const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
    const parsed = storedSecretSchema.parse(JSON.parse(decrypted))
    return {
      type: parsed.type,
      providerId: parsed.providerId,
      accessKeyId: parsed.accessKeyId,
      secretAccessKey: parsed.secretAccessKey,
      namespace: normalizeOciNamespace(parsed.namespace),
      region: normalizeOciCommercialRegion(parsed.region),
      ownerId: parsed.ownerId,
      ...(parsed.ownerDisplayName ? { ownerDisplayName: parsed.ownerDisplayName } : {}),
    }
  } catch (error) {
    if (error instanceof OciObjectStorageCredentialError) throw error
    throw new OciObjectStorageCredentialError('Stored OCI Object Storage credential is malformed')
  }
}
