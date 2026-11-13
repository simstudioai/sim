import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  DATABASE_CONNECTION_DESCRIPTORS,
  type DatabaseConnectionDescriptor,
  type DatabaseConnectionFieldId,
  type DatabaseConnectionProviderId,
  databaseConnectionFieldIds,
} from '@/lib/credentials/database-connections/descriptors'
import {
  type CredentialOwnerScope,
  readOwnerScopedServiceAccountSecret,
} from '@/lib/credentials/owner-scoped-secret.server'
import {
  MSSQL_DEFAULT_CONNECTION_TIMEOUT_MS,
  mssqlConnectionInputSchema,
} from '@/lib/internal/mssql/schema'
import { mysqlConnectionInputSchema } from '@/lib/internal/mysql/schema'
import { postgresqlConnectionInputSchema } from '@/lib/internal/postgresql/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import {
  MSSQL_SERVICE_ACCOUNT_PROVIDER_ID,
  MYSQL_SERVICE_ACCOUNT_PROVIDER_ID,
  POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'

const MAX_SERIALIZED_CONNECTION_BYTES = 64 * 1024
const VERIFY_TIMEOUT_MS = 30_000
const VERIFY_QUERY = 'SELECT 1 AS sim_connection_ok'

/**
 * Tighter bounds a stored login keeps on top of the operation's own connection
 * schema; the transport-security fields and their defaults come from the
 * operation schema unchanged, so a save never accepts a value a run would refuse.
 */
const storedLoginBounds = {
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(255),
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(4096),
}

/**
 * Picks exactly the provider's stored connection fields out of its operation
 * schema. A field the operation adds later (as SQL Server's per-block
 * connection timeout already is) stays out of the stored blob and is never
 * pinned by a saved connection.
 */
function storedFieldMask<P extends DatabaseConnectionProviderId>(providerId: P) {
  const mask: Partial<Record<DatabaseConnectionFieldId<P>, true>> = {}
  for (const id of databaseConnectionFieldIds(providerId)) mask[id] = true
  return mask as Record<DatabaseConnectionFieldId<P>, true>
}

const postgresqlStoredConnectionSchema = postgresqlConnectionInputSchema
  .pick(storedFieldMask(POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID))
  .extend(storedLoginBounds)
  .strict()
const mysqlStoredConnectionSchema = mysqlConnectionInputSchema
  .pick(storedFieldMask(MYSQL_SERVICE_ACCOUNT_PROVIDER_ID))
  .extend(storedLoginBounds)
  .strict()
const mssqlStoredConnectionSchema = mssqlConnectionInputSchema
  .pick(storedFieldMask(MSSQL_SERVICE_ACCOUNT_PROVIDER_ID))
  .extend(storedLoginBounds)
  .strict()

type DatabaseConnection =
  | z.output<typeof postgresqlStoredConnectionSchema>
  | z.output<typeof mysqlStoredConnectionSchema>
  | z.output<typeof mssqlStoredConnectionSchema>

interface DatabaseConnectionSpec {
  descriptor: DatabaseConnectionDescriptor
  /** Discriminator stored inside the encrypted blob; never changes for a provider id. */
  secretType: string
  schema: z.ZodType<DatabaseConnection>
  /**
   * Parses a submitted connection once and binds the probe to that parsed
   * value. The probe runs `SELECT 1` through the block's own operation, so
   * host pinning and TLS match runs.
   */
  parse: (raw: unknown) => {
    connection: DatabaseConnection
    probe: (signal: AbortSignal) => Promise<{ rows: unknown[] }>
  }
}

/** Binds a provider's schema to its probe, so the probe only ever sees that schema's output. */
function defineSpec<Connection extends DatabaseConnection>(
  providerId: DatabaseConnectionProviderId,
  secretType: string,
  schema: z.ZodType<Connection>,
  probe: (connection: Connection, signal: AbortSignal) => Promise<{ rows: unknown[] }>
): DatabaseConnectionSpec {
  return {
    descriptor: DATABASE_CONNECTION_DESCRIPTORS[providerId],
    secretType,
    schema,
    parse: (raw) => {
      const connection = schema.parse(raw)
      return { connection, probe: (signal) => probe(connection, signal) }
    },
  }
}

const SPECS: Record<DatabaseConnectionProviderId, DatabaseConnectionSpec> = {
  [POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID]: defineSpec(
    POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
    'postgresql_connection_v1',
    postgresqlStoredConnectionSchema,
    async (connection, signal) => {
      const { executePostgresqlQuery } = await import('@/lib/internal/postgresql/operations')
      return executePostgresqlQuery({ ...connection, query: VERIFY_QUERY }, signal)
    }
  ),
  [MYSQL_SERVICE_ACCOUNT_PROVIDER_ID]: defineSpec(
    MYSQL_SERVICE_ACCOUNT_PROVIDER_ID,
    'mysql_connection_v1',
    mysqlStoredConnectionSchema,
    async (connection, signal) => {
      const { executeMysqlQuery } = await import('@/lib/internal/mysql/operations')
      return executeMysqlQuery({ ...connection, query: VERIFY_QUERY }, signal)
    }
  ),
  [MSSQL_SERVICE_ACCOUNT_PROVIDER_ID]: defineSpec(
    MSSQL_SERVICE_ACCOUNT_PROVIDER_ID,
    'mssql_connection_v1',
    mssqlStoredConnectionSchema,
    async (connection, signal) => {
      const { executeMssqlQuery } = await import('@/lib/internal/mssql/operations')
      return executeMssqlQuery(
        {
          ...connection,
          connectionTimeout: MSSQL_DEFAULT_CONNECTION_TIMEOUT_MS,
          query: VERIFY_QUERY,
        },
        signal
      )
    }
  ),
}

function secretSchemaFor(spec: DatabaseConnectionSpec) {
  return z.object({ type: z.literal(spec.secretType), connection: spec.schema }).strict()
}

/**
 * A submitted connection that could not be parsed or did not answer `SELECT 1`:
 * the user's input is at fault, unlike a failure to encrypt a verified one.
 */
export class DatabaseConnectionVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseConnectionVerificationError'
  }
}

/**
 * Parses a submitted connection, proves it with `SELECT 1` through the block's
 * own guarded connection path (host validation and IP pinning included), and
 * encrypts it only after the database answered. Driver errors are never
 * surfaced: a server can echo anything, including the login it rejected.
 * Input and verification failures throw `DatabaseConnectionVerificationError`;
 * an encryption failure propagates unchanged.
 */
export async function verifyAndEncryptDatabaseConnection(
  providerId: DatabaseConnectionProviderId,
  serialized: string
) {
  const spec = SPECS[providerId]
  const { label } = spec.descriptor
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_CONNECTION_BYTES) {
    throw new DatabaseConnectionVerificationError(`${label} connection must be at most 64 KiB`)
  }
  let parsed: ReturnType<DatabaseConnectionSpec['parse']>
  try {
    parsed = spec.parse(JSON.parse(serialized))
  } catch {
    throw new DatabaseConnectionVerificationError(`Invalid ${label} connection configuration`)
  }
  const { connection } = parsed
  try {
    const result = await parsed.probe(AbortSignal.timeout(VERIFY_TIMEOUT_MS))
    const [first] = result.rows
    if (!isRecordLike(first) || String(first.sim_connection_ok) !== '1') {
      throw new Error('Invalid verification response')
    }
  } catch {
    throw new DatabaseConnectionVerificationError(`Could not verify the ${label} connection`)
  }
  const { encrypted } = await encryptSecret(JSON.stringify({ type: spec.secretType, connection }))
  return {
    encryptedServiceAccountKey: encrypted,
    username: connection.username,
    displayName: `${connection.username}@${connection.host}/${connection.database}`,
  }
}

/**
 * Loads a saved connection only when the credential is a live connection of
 * this provider owned by exactly `scope`. Every failure reads the same, so a
 * caller cannot tell a foreign credential from a revoked or malformed one.
 */
async function getDatabaseConnection(
  providerId: DatabaseConnectionProviderId,
  credentialId: string,
  scope: CredentialOwnerScope
): Promise<DatabaseConnection> {
  const spec = SPECS[providerId]
  const unavailable = () => new Error(`${spec.descriptor.label} connection is unavailable`)
  let decrypted: string | null
  try {
    decrypted = await readOwnerScopedServiceAccountSecret(credentialId, providerId, scope)
  } catch {
    throw unavailable()
  }
  if (decrypted === null) throw unavailable()
  try {
    return secretSchemaFor(spec).parse(JSON.parse(decrypted)).connection
  } catch {
    throw unavailable()
  }
}

/**
 * Wraps a SQL family's operation handler so it also runs on a saved
 * connection. With no executor-authorized credential for this service the
 * handler gets the request untouched, so inline connection fields behave
 * exactly as before. With one, the stored connection replaces every
 * connection field in the input before the operation parses it: a caller,
 * block default, or model can never steer the host, login, or TLS settings of
 * a shared credential. Nothing is cached; the operation opens and closes its
 * own connection per call.
 */
export function withSavedDatabaseConnection(
  providerId: DatabaseConnectionProviderId,
  handler: InternalToolOperationHandler
): InternalToolOperationHandler {
  const { service, label } = SPECS[providerId].descriptor
  return async (request: InternalToolOperationCall) => {
    const authorized = request.context.authorizedServiceAccountCredential
    if (authorized?.service !== service) return handler(request)

    if (!isRecordLike(request.input)) {
      return Response.json({ error: 'Invalid request data' }, { status: 400 })
    }
    let connection: DatabaseConnection
    try {
      connection = await getDatabaseConnection(providerId, authorized.credentialId, {
        workspaceId: request.context.workspaceId,
        organizationId: request.context.organizationId,
      })
    } catch {
      request.signal?.throwIfAborted()
      return Response.json({ error: `${label} connection is unavailable` }, { status: 403 })
    }
    request.signal?.throwIfAborted()
    return handler({ ...request, input: { ...request.input, ...connection } })
  }
}
