import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { executeOracleStatements } from '@/lib/internal/oracledb/client'
import { oracleConnectionInputSchema } from '@/lib/internal/oracledb/schema'
import { ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const secretSchema = z
  .object({
    type: z.literal('oracledb_connection_v1'),
    connection: oracleConnectionInputSchema,
  })
  .strict()

/** Verifies the bounded Oracle Net connection before storing its encrypted configuration. */
export async function verifyAndEncryptOracleDatabaseCredential(serialized: string) {
  if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('Oracle Database connection must be at most 2 MiB')
  }
  let connection
  try {
    connection = oracleConnectionInputSchema.parse(JSON.parse(serialized))
  } catch {
    throw new Error('Invalid Oracle Database connection configuration')
  }
  try {
    const results = await executeOracleStatements(
      connection,
      [{ sql: 'SELECT 1 AS SIM_CONNECTION_OK FROM DUAL', maxRows: 1 }],
      { readOnlyTransaction: true },
      AbortSignal.timeout(30_000)
    )
    if (results[0]?.rows[0]?.SIM_CONNECTION_OK !== '1')
      throw new Error('Invalid verification response')
  } catch {
    throw new Error('Could not verify the Oracle Database connection')
  }
  const { encrypted } = await encryptSecret(
    JSON.stringify({ type: 'oracledb_connection_v1', connection })
  )
  return { encryptedServiceAccountKey: encrypted, username: connection.username }
}

/** Loads only an executor-authorized reference bound to its trusted owner scope and provider. */
export async function getOracleDatabaseCredential(
  credentialId: string,
  scope: { workspaceId?: string; organizationId?: string }
) {
  const unavailable = () => new Error('Oracle Database credential is unavailable')
  if (!credentialId || (!scope.workspaceId && !scope.organizationId)) throw unavailable()
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
    row.providerId !== ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID ||
    row.revokedAt !== null ||
    !row.encryptedServiceAccountKey
  )
    throw unavailable()
  try {
    const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
    return secretSchema.parse(JSON.parse(decrypted)).connection
  } catch {
    throw unavailable()
  }
}
