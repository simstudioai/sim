import { db } from '@sim/db'
import { credential, credentialGroupEnrollment } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import type { CredentialGroupAuthorizationContext } from '@/lib/credential-groups/application/authorization'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import {
  getCredentialGroupApiKeyFields,
  getCredentialGroupProviderFromProviderId,
  isCredentialGroupApiKeyProvider,
} from '@/lib/credential-groups/providers'
import {
  type ManagedApiKeyProvenanceEntry,
  openManagedApiKeySecret,
} from '@/lib/credentials/managed-api-key'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ManagedApiKeyCredentialApplicationContext
  extends CredentialGroupAuthorizationContext {
  credentialId: string
  credentialGroupEnrollmentId: string
}

export class ManagedApiKeyCredentialError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 401 | 403 | 404 | 409
  ) {
    super(message)
    this.name = 'ManagedApiKeyCredentialError'
  }
}

async function getManagedApiKeyCredential(credentialId: string) {
  const [row] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      providerId: credential.providerId,
      displayName: credential.displayName,
      managedOauthStatus: credential.managedOauthStatus,
      encryptedApiKey: credential.encryptedApiKey,
      providerMetadata: credential.providerMetadata,
      credentialGroupId: credentialGroupEnrollment.credentialGroupId,
      credentialGroupEnrollmentId: credentialGroupEnrollment.id,
      enrollmentEmail: credentialGroupEnrollment.email,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .where(and(eq(credential.id, credentialId), eq(credential.type, 'managed_api_key')))
    .limit(1)
  return row ?? null
}

/** Resolves the canonical workspace context for authorization without reading key material. */
export async function loadManagedApiKeyCredentialApplicationContext(
  credentialId: string
): Promise<ManagedApiKeyCredentialApplicationContext | null> {
  const row = await getManagedApiKeyCredential(credentialId)
  if (!row) return null

  const workspaceContext = await loadActiveWorkspaceApplicationContext(row.workspaceId)
  if (!workspaceContext) return null
  return {
    ...workspaceContext,
    credentialId: row.id,
    credentialGroupId: row.credentialGroupId,
    credentialGroupEnrollmentId: row.credentialGroupEnrollmentId,
  }
}

export interface ResolvedManagedApiKey {
  /** Every credential value, keyed by the provider's field ids. */
  fields: Record<string, string>
  /** One bare-value ciphertext per secret field, for the run's trace registry. */
  provenanceEntries: ManagedApiKeyProvenanceEntry[]
  credentialId: string
  providerId: string
  displayName: string
  email: string | null
}

/**
 * Reads one managed API key after its caller has authorized the access.
 *
 * Entitlement is re-checked here rather than trusted from the caller, matching the managed
 * OAuth path: a workspace that has lapsed off Enterprise stops being able to use credentials
 * its Credential Groups collected, whichever surface asks.
 */
export async function resolveManagedApiKey(params: {
  credentialId: string
  workspaceId: string
  expectedProviderId?: string
}): Promise<ResolvedManagedApiKey> {
  const row = await getManagedApiKeyCredential(params.credentialId)
  if (!row || row.workspaceId !== params.workspaceId) {
    throw new ManagedApiKeyCredentialError(
      'MANAGED_CREDENTIAL_NOT_FOUND',
      'Managed credential not found',
      404
    )
  }
  if (params.expectedProviderId && row.providerId !== params.expectedProviderId) {
    throw new ManagedApiKeyCredentialError(
      'MANAGED_CREDENTIAL_PROVIDER_MISMATCH',
      'Managed credential belongs to a different provider',
      403
    )
  }
  if (row.managedOauthStatus === 'revoked') {
    throw new ManagedApiKeyCredentialError(
      'MANAGED_CREDENTIAL_REVOKED',
      'Managed credential has been revoked',
      401
    )
  }
  if (row.managedOauthStatus !== 'active') {
    throw new ManagedApiKeyCredentialError(
      'MANAGED_CREDENTIAL_NEEDS_REAUTH',
      'Managed credential needs to be provided again',
      401
    )
  }
  if (!row.encryptedApiKey) {
    throw new ManagedApiKeyCredentialError(
      'MANAGED_CREDENTIAL_UNUSABLE',
      'Managed credential has no stored key',
      409
    )
  }

  const billing = await getWorkspaceOwnerSubscriptionAccess(row.workspaceId)
  if (
    !(await isCredentialGroupsAvailable({ workspaceId: row.workspaceId, ownerBilling: billing }))
  ) {
    throw new ManagedApiKeyCredentialError(
      'MANAGED_CREDENTIAL_UNAVAILABLE',
      'Credential Groups are not available for this workspace',
      403
    )
  }

  const provider = getCredentialGroupProviderFromProviderId(row.providerId ?? '')
  if (!isCredentialGroupApiKeyProvider(provider)) {
    throw new ManagedApiKeyCredentialError(
      'MANAGED_CREDENTIAL_PROVIDER_MISMATCH',
      'Managed credential does not belong to an API key provider',
      403
    )
  }
  const { fields, provenanceEntries } = await openManagedApiKeySecret(
    { encryptedApiKey: row.encryptedApiKey },
    getCredentialGroupApiKeyFields(provider)
  )
  return {
    fields,
    provenanceEntries,
    credentialId: row.id,
    providerId: row.providerId ?? '',
    displayName: row.displayName,
    email: row.providerMetadata?.email ?? null,
  }
}
