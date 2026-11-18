/**
 * Client-safe descriptors for saved database connections.
 *
 * A saved database connection is a `service_account`-type credential holding
 * the host, port, database, login, password, and transport-security settings
 * a SQL block otherwise takes inline. It is verified once with a cheap
 * `SELECT 1` through the block's own guarded connection path, stored
 * encrypted, and read back inside the tool operation on every run; nothing
 * about it reaches the tool params, the model, or the browser after saving.
 * Server-side verification and resolution live in
 * `@/lib/credentials/database-connections/server`.
 */
import type { MssqlToggle } from '@/lib/internal/mssql/schema'
import type { MysqlSslMode } from '@/lib/internal/mysql/schema'
import type { PostgresqlSslMode } from '@/lib/internal/postgresql/schema'
import {
  MSSQL_SERVICE_ACCOUNT_PROVIDER_ID,
  MYSQL_SERVICE_ACCOUNT_PROVIDER_ID,
  POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'

/** The `service_account` provider id of a saved PostgreSQL, MySQL, or SQL Server connection. */
export type DatabaseConnectionProviderId =
  | typeof POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MYSQL_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MSSQL_SERVICE_ACCOUNT_PROVIDER_ID

/** A transport-security setting the connection stores beside its login. */
interface DatabaseTlsField {
  /** The tool param, and the stored connection field, it fills. */
  id: 'ssl' | 'encrypt' | 'trustServerCertificate'
  label: string
  options: readonly { value: string; label: string }[]
  defaultValue: string
  hint: string
}

/**
 * Everything the connect modal, the provider catalog, and the blocks need to
 * know about one saved database connection type, without server-only code.
 */
export interface DatabaseConnectionDescriptor {
  providerId: DatabaseConnectionProviderId
  /** The OAuth service id its blocks' picker and tools name. */
  service: 'postgresql' | 'mysql' | 'mssql'
  /** Product name used in modal copy and errors. */
  label: string
  defaultPort: number
  usernamePlaceholder: string
  tls: readonly DatabaseTlsField[]
  docsUrl: string
}

/**
 * Picker options in display order. Keyed by the operation schema's own value
 * type, so a value the operations add or drop fails to compile here instead of
 * drifting between the picker and what a save accepts.
 */
function optionsFrom<Value extends string>(labels: Record<Value, string>) {
  return Object.entries<string>(labels).map(([value, label]) => ({ value, label }))
}

export const DATABASE_CONNECTION_DESCRIPTORS = {
  [POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
    service: 'postgresql',
    label: 'PostgreSQL',
    defaultPort: 5432,
    usernamePlaceholder: 'postgres',
    tls: [
      {
        id: 'ssl',
        label: 'SSL mode',
        options: optionsFrom<PostgresqlSslMode>({
          preferred: 'Preferred',
          required: 'Required',
          disabled: 'Disabled',
        }),
        defaultValue: 'preferred' satisfies PostgresqlSslMode,
        hint: 'Required encrypts the connection without verifying the server certificate. Preferred falls back to an unencrypted connection when the server offers no TLS, which an attacker on the network can force; choose Required when the server supports TLS.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/postgresql',
  },
  [MYSQL_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: MYSQL_SERVICE_ACCOUNT_PROVIDER_ID,
    service: 'mysql',
    label: 'MySQL',
    defaultPort: 3306,
    usernamePlaceholder: 'root',
    tls: [
      {
        id: 'ssl',
        label: 'SSL mode',
        options: optionsFrom<MysqlSslMode>({
          preferred: 'Preferred',
          required: 'Required',
          disabled: 'Disabled',
        }),
        defaultValue: 'preferred' satisfies MysqlSslMode,
        hint: "Required encrypts the connection and verifies the certificate chain against the runtime's trust store, but not the host name (like MySQL's VERIFY_CA). Preferred encrypts without verifying the certificate. Both refuse a server that offers no TLS rather than connect unencrypted.",
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/mysql',
  },
  [MSSQL_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: MSSQL_SERVICE_ACCOUNT_PROVIDER_ID,
    service: 'mssql',
    label: 'Microsoft SQL Server',
    defaultPort: 1433,
    usernamePlaceholder: 'sa',
    tls: [
      {
        id: 'encrypt',
        label: 'Encrypt connection',
        options: optionsFrom<MssqlToggle>({ enabled: 'Enabled', disabled: 'Disabled' }),
        defaultValue: 'enabled' satisfies MssqlToggle,
        hint: 'Requests TLS. A server that does not support encryption gets an unencrypted session rather than an error.',
      },
      {
        id: 'trustServerCertificate',
        label: 'Trust server certificate',
        options: optionsFrom<MssqlToggle>({ disabled: 'Disabled', enabled: 'Enabled' }),
        defaultValue: 'disabled' satisfies MssqlToggle,
        hint: 'Enable only for a server with a self-signed certificate; it skips certificate validation.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/mssql',
  },
} as const satisfies Record<DatabaseConnectionProviderId, DatabaseConnectionDescriptor>

const DATABASE_LOGIN_FIELD_IDS = ['host', 'port', 'database', 'username', 'password'] as const

/** A field a saved connection of provider `P` stores: a login field or one of its TLS settings. */
export type DatabaseConnectionFieldId<P extends DatabaseConnectionProviderId> =
  | (typeof DATABASE_LOGIN_FIELD_IDS)[number]
  | (typeof DATABASE_CONNECTION_DESCRIPTORS)[P]['tls'][number]['id']

/**
 * Every field a saved connection of this provider stores: the login, then its
 * transport-security settings. The stored schema keeps exactly these fields
 * and the tools declare exactly these as credential-supplied, so what a blob
 * persists, what a run replaces, and what the block hides share one list.
 * Changing a provider's list changes its stored blob, so it needs a new
 * secret type.
 */
export function databaseConnectionFieldIds<P extends DatabaseConnectionProviderId>(
  providerId: P
): DatabaseConnectionFieldId<P>[] {
  return [
    ...DATABASE_LOGIN_FIELD_IDS,
    ...tlsFieldIds(DATABASE_CONNECTION_DESCRIPTORS[providerId].tls),
  ]
}

function tlsFieldIds<Fields extends readonly DatabaseTlsField[]>(
  fields: Fields
): Fields[number]['id'][] {
  return fields.map((field) => field.id)
}

/** Whether a provider id names a saved database connection (`postgresql-service-account`, `mysql-service-account`, or `mssql-service-account`). */
export function isDatabaseConnectionProviderId(
  value: string | null | undefined
): value is DatabaseConnectionProviderId {
  return typeof value === 'string' && Object.hasOwn(DATABASE_CONNECTION_DESCRIPTORS, value)
}

/**
 * The saved-connection descriptor for a database provider id, or `undefined`
 * when the id is missing or names a provider that is not a database connection.
 */
export function getDatabaseConnectionDescriptor(
  providerId: string | null | undefined
): DatabaseConnectionDescriptor | undefined {
  return isDatabaseConnectionProviderId(providerId)
    ? DATABASE_CONNECTION_DESCRIPTORS[providerId]
    : undefined
}
