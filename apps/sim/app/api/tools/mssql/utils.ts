import net from 'node:net'
import sql from 'mssql'
import {
  maskSqlStringLiterals,
  validateDatabaseHost,
  validateSqlWhereClause,
} from '@/lib/core/security/input-validation.server'

export interface MSSQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt: 'enabled' | 'disabled'
  trustServerCertificate: 'enabled' | 'disabled'
  connectionTimeout: number
}

/**
 * Opens a TCP socket to an already-validated IP address.
 *
 * Tedious calls the `connector` instead of resolving and connecting itself, so
 * this is what keeps the connection pinned to the address the SSRF guard
 * approved rather than to whatever DNS answers a second time.
 * @see https://tediousjs.github.io/tedious/api-connection.html
 */
function connectToPinnedAddress(address: string, port: number, timeoutMs: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host: address, port })
    socket.setNoDelay(true)
    socket.setTimeout(timeoutMs)

    const fail = (error: Error) => {
      socket.destroy()
      reject(error)
    }

    socket.once('connect', () => {
      socket.setTimeout(0)
      resolve(socket)
    })
    socket.once('timeout', () => fail(new Error(`Connection to ${address}:${port} timed out`)))
    socket.once('error', fail)
  })
}

/**
 * Opens a single-connection `mssql` pool against the SSRF-validated address.
 *
 * `options.connector` supplies a socket already connected to the resolved IP,
 * which closes the DNS-rebinding window the way the PostgreSQL and MySQL tools
 * do. `server` stays the original hostname because tedious derives the TLS
 * `servername` from it independently of the connector, so SNI and certificate
 * validation are unaffected by the pin.
 *
 * Named instances are deliberately unsupported: tedious resolves them with a
 * UDP SQL Server Browser lookup issued against the hostname *outside* the
 * connector, and node-mssql deletes `port` whenever `instanceName` is set, so
 * there is no configuration in which a named instance stays pinned. Connect to
 * a named instance by giving it a static TCP port instead.
 * @see https://tediousjs.github.io/tedious/api-connection.html
 * @see https://github.com/tediousjs/node-mssql#general-same-for-all-drivers
 */
export async function createMSSQLConnection(
  config: MSSQLConnectionConfig
): Promise<sql.ConnectionPool> {
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const pinnedAddress = hostValidation.resolvedIP ?? config.host

  const pool = new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectionTimeout: config.connectionTimeout,
    requestTimeout: config.connectionTimeout,
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 20000,
    },
    options: {
      encrypt: config.encrypt === 'enabled',
      trustServerCertificate: config.trustServerCertificate === 'enabled',
      connector: () => connectToPinnedAddress(pinnedAddress, config.port, config.connectionTimeout),
    },
  })
  await pool.connect()

  return pool
}

export interface MSSQLQueryResult {
  rows: unknown[]
  rowCount: number
}

/**
 * Runs a statement with positional values bound as `@param1`, `@param2`, … .
 *
 * `recordset` holds the first result set and `rowsAffected` holds one count per
 * statement, so a SELECT reports its row count and a DML statement reports the
 * summed affected rows.
 * @see https://github.com/tediousjs/node-mssql#request
 */
export async function executeQuery(
  pool: sql.ConnectionPool,
  query: string,
  values: unknown[] = []
): Promise<MSSQLQueryResult> {
  const request = pool.request()
  values.forEach((value, index) => {
    request.input(`param${index + 1}`, value)
  })

  const result = await request.query(query)
  const rows: unknown[] = result.recordset ?? []
  const affected = (result.rowsAffected ?? []).reduce(
    (total: number, count: number) => total + count,
    0
  )

  return {
    rows,
    rowCount: rows.length > 0 ? rows.length : affected,
  }
}

/**
 * Restricts the Query operation to statements that only read.
 *
 * The block label, the tool description, and the docs all present this
 * operation as SELECT-only, so it must not double as a second path to DML —
 * `mssql_execute` is the operation that accepts mutations. Without this an
 * agent choosing `mssql_query` because "it is only a SELECT" could delete rows.
 *
 * A leading `WITH` is admitted because a CTE is the normal way to write a
 * non-trivial SELECT, but T-SQL also allows `WITH x AS (...) DELETE FROM x`, so
 * the body is screened for mutating keywords rather than trusting the leading
 * token alone. Screening runs over the statement with string literals masked by
 * the shared {@link maskSqlStringLiterals}, which keeps ordinary prose in a
 * WHERE clause from tripping it.
 *
 * The screen is lexical, not a parser, so it can still reject a legitimate
 * query that uses a keyword as a bare identifier. It fails closed on purpose,
 * and the Execute Raw SQL operation is the escape hatch for anything rejected.
 */
export function validateReadOnlyQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim()

  if (!/^(select|with)\s/i.test(trimmedQuery)) {
    return {
      isValid: false,
      error:
        'The Query operation only accepts SELECT statements, optionally led by a WITH clause. Use the Execute Raw SQL operation to run anything else.',
    }
  }

  const mutating =
    /\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|exec|execute|into)\b/i.exec(
      maskSqlStringLiterals(trimmedQuery)
    )
  if (mutating) {
    return {
      isValid: false,
      error: `The Query operation cannot run ${mutating[0].toUpperCase()}. Use the Execute Raw SQL operation for statements that modify data or schema.`,
    }
  }

  return { isValid: true }
}

export function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim()

  const allowedStatements = /^(select|insert|update|delete|with|merge|exec|execute|declare)\s+/i
  if (!allowedStatements.test(trimmedQuery)) {
    return {
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, MERGE, EXEC, EXECUTE, and DECLARE statements are allowed',
    }
  }

  return { isValid: true }
}

export function buildInsertQuery(table: string, data: Record<string, unknown>) {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)
  const placeholders = columns.map((_, index) => `@param${index + 1}`).join(', ')

  const query = `INSERT INTO ${sanitizedTable} (${columns.map(sanitizeIdentifier).join(', ')}) VALUES (${placeholders})`

  return { query, values }
}

export function buildUpdateQuery(table: string, data: Record<string, unknown>, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)

  const setClause = columns
    .map((col, index) => `${sanitizeIdentifier(col)} = @param${index + 1}`)
    .join(', ')
  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where}`

  return { query, values }
}

export function buildDeleteQuery(table: string, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where}`

  return { query, values: [] as unknown[] }
}

/**
 * T-SQL-specific WHERE screening layered on top of the shared guard.
 *
 * The first pattern is the one that does not generalize: **T-SQL does not
 * require a statement terminator**, so `id = 1 DROP TABLE dbo.users` is a valid
 * two-statement batch and every semicolon-anchored stacked-query check — the
 * shared guard's included — reads straight past it. Screening for a bare
 * statement-introducing keyword is what closes that. Word boundaries keep
 * ordinary column names (`updated_at`, `deleted_at`, `created_by`) matching
 * nothing; a column whose name *is* a bare keyword must be reached through the
 * Execute Raw SQL operation instead.
 *
 * The rest are SQL Server surfaces the shared guard has no reason to know
 * about: the `OPEN*` rowset functions, `BULK INSERT`, `WAITFOR` timing probes,
 * catalog and legacy compatibility views (`master..sysobjects`), and the
 * extended/OLE-automation procedures.
 * @see https://learn.microsoft.com/en-us/sql/t-sql/language-elements/transact-sql-syntax-conventions-transact-sql
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/catalog-views-transact-sql
 */
const MSSQL_WHERE_PATTERNS: readonly RegExp[] = [
  /\b(?:drop|create|alter|truncate|grant|revoke|insert|update|delete|merge|exec|execute|backup|restore|shutdown|reconfigure)\b/i,
  /\bopenrowset\s*\(/i,
  /\bopendatasource\s*\(/i,
  /\bopenquery\s*\(/i,
  /\bopenxml\s*\(/i,
  /\bbulk\s+insert\b/i,
  /\bwaitfor\s+(?:delay|time)\b/i,
  /information_schema/i,
  /\bsys\./i,
  /\.\.\s*sys\w*/i,
  /\bsys(?:objects|columns|databases|users|indexes|comments)\b/i,
  /\bxp_\w+/i,
  /\bsp_(?:executesql|oacreate|oamethod|oagetproperty|configure|addextendedproc)\b/i,
]

/**
 * Rejects WHERE clauses containing injection or always-true tautology patterns
 * so a user-supplied condition cannot broaden an update or delete to every row.
 *
 * Delegates the shared checks to {@link validateSqlWhereClause} — which masks
 * string literals before scanning, so prose inside a quoted value cannot trip a
 * structural pattern — then applies the T-SQL-specific screening above.
 *
 * As the shared guard's own documentation states, this is defense-in-depth
 * rather than a security boundary: the caller supplies their own database
 * credentials and can run equivalent SQL through the Execute Raw SQL operation.
 * It stops the easy ways an injected condition escalates, nothing more.
 * @throws {Error} If the WHERE clause matches any screened pattern
 */
function validateWhereClause(where: string): void {
  const shared = validateSqlWhereClause(where, 'WHERE clause')
  if (!shared.isValid) {
    throw new Error(shared.error)
  }

  const masked = maskSqlStringLiterals(where)
  if (MSSQL_WHERE_PATTERNS.some((pattern) => pattern.test(masked))) {
    throw new Error('WHERE clause contains potentially dangerous operation')
  }
}

export function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    const parts = identifier.split('.')
    return parts.map((part) => sanitizeSingleIdentifier(part)).join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/[[\]]/g, '')

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  return `[${cleaned}]`
}

export interface MSSQLIntrospectionResult {
  tables: Array<{
    name: string
    schema: string
    columns: Array<{
      name: string
      type: string
      nullable: boolean
      default: string | null
      isPrimaryKey: boolean
      isForeignKey: boolean
      references?: {
        table: string
        column: string
      }
    }>
    primaryKey: string[]
    foreignKeys: Array<{
      column: string
      referencesTable: string
      referencesColumn: string
    }>
    indexes: Array<{
      name: string
      columns: string[]
      unique: boolean
    }>
  }>
  schemas: string[]
}

interface SchemaRow {
  SCHEMA_NAME: string
}

interface TableRow {
  TABLE_NAME: string
  TABLE_SCHEMA: string
}

interface ColumnRow {
  COLUMN_NAME: string
  DATA_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
}

interface KeyColumnRow {
  COLUMN_NAME: string
}

interface ForeignKeyRow {
  COLUMN_NAME: string
  REFERENCED_TABLE_NAME: string
  REFERENCED_COLUMN_NAME: string
}

interface IndexRow {
  INDEX_NAME: string
  COLUMN_NAME: string
  IS_UNIQUE: boolean | number
}

/**
 * Reads table, column, key, and index metadata for a schema.
 *
 * Every view read here except `sys.schemas` is metadata-visibility filtered —
 * "limited to securables that a user either owns, or on which the user was
 * granted some permission" — so a low-privilege login gets a silently partial
 * result rather than an error.
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-information-schema-views/system-information-schema-views-transact-sql
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/security/metadata-visibility-configuration
 */
export async function executeIntrospect(
  pool: sql.ConnectionPool,
  schemaName: string
): Promise<MSSQLIntrospectionResult> {
  /**
   * `sys.schemas` rather than `INFORMATION_SCHEMA.SCHEMATA` because it needs
   * only membership in `public` and carries no metadata-visibility caveat.
   * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/schemas-catalog-views-sys-schemas
   */
  const schemasResult = await pool.request().query<SchemaRow>(
    `SELECT s.name AS SCHEMA_NAME
     FROM sys.schemas s
     WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest',
       'db_accessadmin', 'db_backupoperator', 'db_datareader', 'db_datawriter',
       'db_ddladmin', 'db_denydatareader', 'db_denydatawriter', 'db_owner', 'db_securityadmin')
     ORDER BY s.name`
  )
  const schemas = schemasResult.recordset.map((row: SchemaRow) => row.SCHEMA_NAME)

  const tablesResult = await pool
    .request()
    .input('schema', schemaName)
    .query<TableRow>(
      `SELECT TABLE_NAME, TABLE_SCHEMA
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
    )

  const tables: MSSQLIntrospectionResult['tables'] = []

  for (const tableRow of tablesResult.recordset as TableRow[]) {
    const tableName = tableRow.TABLE_NAME
    const tableSchema = tableRow.TABLE_SCHEMA

    const columnsResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<ColumnRow>(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
         ORDER BY ORDINAL_POSITION`
      )

    const pkResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<KeyColumnRow>(
        `SELECT kcu.COLUMN_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
           ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
           AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
         WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
           AND tc.TABLE_SCHEMA = @schema
           AND tc.TABLE_NAME = @table
         ORDER BY kcu.ORDINAL_POSITION`
      )
    const primaryKeyColumns = pkResult.recordset.map((row: KeyColumnRow) => row.COLUMN_NAME)

    const fkResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<ForeignKeyRow>(
        /**
         * Resolved through the catalog views rather than
         * `INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS`, which reaches the
         * referenced side by joining `TABLE_CONSTRAINTS` — a view that returns
         * "one row for each table constraint" and so has no row at all when a
         * foreign key references a unique *index*, silently dropping the key.
         * The catalog views resolve the referenced table and column by ID.
         * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-foreign-key-columns-transact-sql
         * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-information-schema-views/table-constraints-transact-sql
         */
        `SELECT
           pc.name AS COLUMN_NAME,
           rt.name AS REFERENCED_TABLE_NAME,
           rc.name AS REFERENCED_COLUMN_NAME
         FROM sys.foreign_keys fk
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
         JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
         JOIN sys.columns pc
           ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
         JOIN sys.columns rc
           ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
         WHERE ps.name = @schema AND pt.name = @table
         ORDER BY fk.name, fkc.constraint_column_id`
      )

    const foreignKeys = fkResult.recordset.map((row: ForeignKeyRow) => ({
      column: row.COLUMN_NAME,
      referencesTable: row.REFERENCED_TABLE_NAME,
      referencesColumn: row.REFERENCED_COLUMN_NAME,
    }))

    const fkByColumn = new Map<string, (typeof foreignKeys)[number]>()
    for (const fk of foreignKeys) {
      if (!fkByColumn.has(fk.column)) fkByColumn.set(fk.column, fk)
    }

    const indexResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<IndexRow>(
        /**
         * `key_ordinal > 0` is what restricts the result to key columns: it is
         * the "ordinal (1-based) within set of key-columns", and `0` marks both
         * INCLUDEd non-key columns and partitioning columns — the latter of
         * which also report `is_included_column = 0`, so that flag alone would
         * let them through.
         * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-index-columns-transact-sql
         */
        `SELECT i.name AS INDEX_NAME, c.name AS COLUMN_NAME, i.is_unique AS IS_UNIQUE
         FROM sys.indexes i
         JOIN sys.index_columns ic
           ON i.object_id = ic.object_id AND i.index_id = ic.index_id
         JOIN sys.columns c
           ON ic.object_id = c.object_id AND ic.column_id = c.column_id
         JOIN sys.tables t ON i.object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE s.name = @schema
           AND t.name = @table
           AND i.is_primary_key = 0
           AND i.name IS NOT NULL
           AND ic.key_ordinal > 0
         ORDER BY i.name, ic.key_ordinal`
      )

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexResult.recordset as IndexRow[]) {
      const indexName = row.INDEX_NAME
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, { name: indexName, columns: [], unique: Boolean(row.IS_UNIQUE) })
      }
      indexMap.get(indexName)!.columns.push(row.COLUMN_NAME)
    }
    const indexes = Array.from(indexMap.values())

    const primaryKeySet = new Set(primaryKeyColumns)

    const columns = columnsResult.recordset.map((col: ColumnRow) => {
      const columnName = col.COLUMN_NAME
      const fk = fkByColumn.get(columnName)

      return {
        name: columnName,
        type: col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        default: col.COLUMN_DEFAULT ?? null,
        isPrimaryKey: primaryKeySet.has(columnName),
        isForeignKey: fk !== undefined,
        ...(fk && {
          references: {
            table: fk.referencesTable,
            column: fk.referencesColumn,
          },
        }),
      }
    })

    tables.push({
      name: tableName,
      schema: tableSchema,
      columns,
      primaryKey: primaryKeyColumns,
      foreignKeys,
      indexes,
    })
  }

  return { tables, schemas }
}
