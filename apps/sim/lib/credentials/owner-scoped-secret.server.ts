import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'

/** The workspace or organization an executor-authorized credential must belong to. */
export interface CredentialOwnerScope {
  workspaceId?: string
  organizationId?: string
}

/**
 * Decrypts a live service-account credential of `providerId` owned by exactly
 * `scope`: a workspace credential when the workspace matches, or an
 * organization credential when the organization matches. Returns `null` for
 * anything else (no scope, another owner, another provider, revoked, or no
 * stored secret) without decrypting, so callers fail closed with their own
 * provider-specific message. `getAwsCredentialConfig` keeps its own copy of
 * this read because it also needs the matched owner.
 */
export async function readOwnerScopedServiceAccountSecret(
  credentialId: string,
  providerId: string,
  scope: CredentialOwnerScope
): Promise<string | null> {
  if (!credentialId || (!scope.workspaceId && !scope.organizationId)) return null
  const [row] = await db
    .select({
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      type: credential.type,
      providerId: credential.providerId,
      revokedAt: credential.revokedAt,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(
      and(
        eq(credential.id, credentialId),
        or(
          scope.workspaceId
            ? and(eq(credential.workspaceId, scope.workspaceId), isNull(credential.organizationId))
            : undefined,
          scope.organizationId
            ? and(
                eq(credential.organizationId, scope.organizationId),
                isNull(credential.workspaceId)
              )
            : undefined
        )
      )
    )
    .limit(1)
  const ownerMatches =
    row &&
    ((row.workspaceId === scope.workspaceId &&
      !!scope.workspaceId &&
      row.organizationId === null) ||
      (row.organizationId === scope.organizationId &&
        !!scope.organizationId &&
        row.workspaceId === null))
  if (
    !ownerMatches ||
    row.type !== 'service_account' ||
    row.providerId !== providerId ||
    row.revokedAt !== null ||
    !row.encryptedServiceAccountKey
  )
    return null
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  return decrypted
}
