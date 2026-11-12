import { z } from 'zod'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  type CredentialOwnerScope,
  readOwnerScopedServiceAccountSecret,
} from '@/lib/credentials/owner-scoped-secret.server'
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
  scope: CredentialOwnerScope
) {
  const unavailable = () => new Error('Oracle Database credential is unavailable')
  let decrypted: string | null
  try {
    decrypted = await readOwnerScopedServiceAccountSecret(
      credentialId,
      ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
      scope
    )
  } catch {
    throw unavailable()
  }
  if (decrypted === null) throw unavailable()
  try {
    return secretSchema.parse(JSON.parse(decrypted)).connection
  } catch {
    throw unavailable()
  }
}
