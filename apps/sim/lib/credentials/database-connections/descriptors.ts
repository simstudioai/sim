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
import {
  MSSQL_SERVICE_ACCOUNT_PROVIDER_ID,
  MYSQL_SERVICE_ACCOUNT_PROVIDER_ID,
  POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'

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

const SSL_MODE_OPTIONS = [
  { value: 'preferred', label: 'Preferred' },
  { value: 'required', label: 'Required' },
  { value: 'disabled', label: 'Disabled' },
] as const

const TOGGLE_OPTIONS = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
] as const

export const DATABASE_CONNECTION_DESCRIPTORS: Record<
  DatabaseConnectionProviderId,
  DatabaseConnectionDescriptor
> = {
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
        options: SSL_MODE_OPTIONS,
        defaultValue: 'preferred',
        hint: 'Required encrypts the connection without verifying the server certificate; Preferred falls back to an unencrypted connection when the server offers no TLS.',
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
        options: SSL_MODE_OPTIONS,
        defaultValue: 'preferred',
        hint: 'Required encrypts the connection and verifies the server certificate; Preferred encrypts without verifying it.',
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
        options: TOGGLE_OPTIONS,
        defaultValue: 'enabled',
        hint: 'Encrypts the connection with TLS.',
      },
      {
        id: 'trustServerCertificate',
        label: 'Trust server certificate',
        options: [...TOGGLE_OPTIONS].reverse(),
        defaultValue: 'disabled',
        hint: 'Enable only for a server with a self-signed certificate; it skips certificate validation.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/mssql',
  },
}

export function isDatabaseConnectionProviderId(
  value: string | null | undefined
): value is DatabaseConnectionProviderId {
  return typeof value === 'string' && Object.hasOwn(DATABASE_CONNECTION_DESCRIPTORS, value)
}

export function getDatabaseConnectionDescriptor(
  providerId: string | null | undefined
): DatabaseConnectionDescriptor | undefined {
  return isDatabaseConnectionProviderId(providerId)
    ? DATABASE_CONNECTION_DESCRIPTORS[providerId]
    : undefined
}
