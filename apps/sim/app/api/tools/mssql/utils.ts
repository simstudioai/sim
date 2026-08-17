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
 *
 * An Azure SQL `Redirect` routing response is unsupported for the same reason
 * and fails the same safe way. tedious reconnects on a LOGIN7 routing envchange,
 * but a zero-argument connector ignores the redirect target and reconnects to
 * the pinned address — which is the behavior we want, since the redirect target
 * is chosen by the server and honoring it would be the rebinding the pin exists
 * to stop. Reach Azure SQL through a `Proxy`-policy connection.
 *
 * `requestTimeout` intentionally tracks `connectionTimeout` off the single knob
 * the block exposes, which the field labels as covering both. tedious governs
 * the whole login handshake (prelogin, TLS, LOGIN7) with `connectTimeout`
 * regardless of the connector, so the socket's own timeout is cleared once it is
 * connected rather than left to fire during a slow login.
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
  try {
    await pool.connect()
  } catch (error) {
    /**
     * Only a pool that was handed back gets closed by the route's `finally`, so
     * a pool that failed to connect has to release its own tarn resources here
     * or a bad credential retried in a loop leaks one every attempt. `close()`
     * on a pool that never connected is a no-op rather than an error, and its
     * own failure must not mask the connect error the caller needs to see.
     */
    await pool.close().catch(() => {})
    throw error
  }

  return pool
}

export interface MSSQLQueryResult {
  rows: unknown[]
  rowCount: number
  /** Set when the recordset hit a row or byte ceiling and rows were dropped. */
  truncated?: boolean
  /** Human-readable explanation of the ceiling that was hit. */
  truncationReason?: string
}

/**
 * Prepares a JSON-sourced value for `request.input()`.
 *
 * With no explicit type, node-mssql infers one from the value — and its object
 * branch only recognises `String`, `Number`, `Boolean`, `Date`, `Buffer`, and
 * `Table`. Anything else (a nested object, an array) is inferred as `NVarChar`
 * while staying an object, and tedious's `NVarChar.validate` then throws a bare
 * `Invalid string.` with nothing naming the column. Since `data` arrives as
 * arbitrary JSON, serializing those to JSON text is both the only sound binding
 * and what a caller writing into an `nvarchar`/JSON column means.
 * @see https://github.com/tediousjs/node-mssql#data-types
 */
function toBindableValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (value instanceof Date || Buffer.isBuffer(value)) return value
  return JSON.stringify(value)
}

/**
 * Ceilings on what a single statement may materialize into the response.
 *
 * The driver buffers the whole recordset before `request.query` resolves, and
 * the route then serializes it into a JSON body, so an unbounded `SELECT` over a
 * large table is held in memory twice. A caller who wants more pages it with
 * `OFFSET ... FETCH NEXT`. The byte ceiling exists because row count alone does
 * not bound size — 1,000 rows of `nvarchar(max)` is not a small result.
 */
const MSSQL_MAX_RESULT_ROWS = 10_000
const MSSQL_MAX_RESULT_BYTES = 10 * 1024 * 1024

/**
 * Bytes held back from {@link MSSQL_MAX_RESULT_BYTES} for the part of the
 * response body that is not a row.
 *
 * {@link toRowsResponseBody} wraps `rows` in `message`, `rowCount`, and — when
 * the recordset was capped — `truncated` and `truncationReason`, none of which
 * the per-row accounting can see. Those are a few hundred bytes at their
 * longest (the truncation prose is the bulk of it), so the reserve is set an
 * order of magnitude above the worst case and costs 0.04% of the ceiling. The
 * alternative, serializing the assembled body to check it, would re-serialize
 * the whole recordset a second time for no useful precision.
 */
const MSSQL_RESPONSE_ENVELOPE_BYTES = 4096

/** What the serialized `rows` array itself may occupy. */
const MSSQL_MAX_ROWS_BYTES = MSSQL_MAX_RESULT_BYTES - MSSQL_RESPONSE_ENVELOPE_BYTES

/**
 * Truncates a recordset to the row and byte ceilings.
 *
 * Measures each row with `JSON.stringify` because that is what the route will do
 * anyway, so the number bounds the response the caller actually receives rather
 * than an in-memory estimate that does not correspond to it. Each row is
 * serialized exactly once and its cost accumulated, rather than re-serializing
 * the growing array per row, which would be quadratic on a large recordset.
 *
 * The size is `Buffer.byteLength(..., 'utf8')`, not `String.length`. `length`
 * counts UTF-16 code units while `NextResponse.json` emits UTF-8, and every
 * character above U+007F costs more bytes than code units — worst case 3:1, for
 * the U+0800–U+FFFF range that holds CJK, so a recordset of Chinese text passed
 * a 10 MB `length` budget while serializing to nearly 30 MB. (Astral characters
 * such as emoji are only 2:1: 4 bytes across 2 surrogate code units.)
 *
 * The array's own punctuation is counted too — one byte per row covers the
 * opening `[` for the first row and the separating `,` for each one after it,
 * with the leading byte standing in for the closing `]` — and
 * {@link MSSQL_RESPONSE_ENVELOPE_BYTES} covers the fields around it. Without
 * both, a result packed exactly to the ceiling still emitted a body over it.
 *
 * A row is admitted only when it still fits, so a single row larger than the
 * byte ceiling is dropped rather than admitted as a lone exception — otherwise
 * `SELECT` of one `nvarchar(max)` value would serialize an unbounded body and
 * the ceiling would bound everything except the case it exists for. The drop is
 * disclosed through {@link MSSQLQueryResult.truncationReason}, so an empty
 * recordset is never mistaken for an empty table.
 */
function capRecordset(rows: unknown[]): { rows: unknown[]; truncated: boolean } {
  if (rows.length === 0) return { rows, truncated: false }

  const capped: unknown[] = []
  /** The closing `]`; each row below pays for its own `[` or `,`. */
  let bytes = 1

  for (const row of rows) {
    if (capped.length >= MSSQL_MAX_RESULT_ROWS) break
    const serialized = JSON.stringify(row)
    /**
     * `JSON.stringify` answers `undefined` for a value it cannot represent, but
     * an array element in that position serializes as the four bytes of `null`.
     */
    const rowBytes = serialized === undefined ? 4 : Buffer.byteLength(serialized, 'utf8')
    if (bytes + rowBytes + 1 > MSSQL_MAX_ROWS_BYTES) break
    bytes += rowBytes + 1
    capped.push(row)
  }

  return { rows: capped, truncated: capped.length < rows.length }
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
    request.input(`param${index + 1}`, toBindableValue(value))
  })

  const result = await request.query(query)
  const { rows, truncated } = capRecordset(result.recordset ?? [])
  const affected = (result.rowsAffected ?? []).reduce(
    (total: number, count: number) => total + count,
    0
  )

  return {
    rows,
    rowCount: rows.length > 0 ? rows.length : affected,
    ...(truncated && {
      truncated: true,
      truncationReason:
        rows.length === 0
          ? `No rows returned: the first row alone exceeds the ${MSSQL_MAX_RESULT_BYTES / (1024 * 1024)} MB response ceiling. Select fewer columns, or slice large values with SUBSTRING.`
          : `Result truncated to ${rows.length} row(s): a single statement returns at most ${MSSQL_MAX_RESULT_ROWS} rows or ${MSSQL_MAX_RESULT_BYTES / (1024 * 1024)} MB. Page with OFFSET ... FETCH NEXT to read the rest.`,
    }),
  }
}

/**
 * Builds the success body every statement route returns.
 *
 * A truncated recordset is disclosed twice on purpose: folded into `message`, so
 * an agent that reads only the status line still learns rows were dropped, and
 * as `truncated`/`truncationReason`, so a caller can branch on it without
 * parsing prose. Without this the route reported a capped result as a complete
 * one and paging looked unnecessary.
 */
export function toRowsResponseBody(result: MSSQLQueryResult, message: string) {
  return {
    message: result.truncationReason ? `${message} ${result.truncationReason}` : message,
    rows: result.rows,
    rowCount: result.rowCount,
    ...(result.truncated && {
      truncated: true,
      truncationReason: result.truncationReason,
    }),
  }
}

/**
 * Every T-SQL keyword that introduces a statement with an effect — DML, DDL,
 * permissions, and the administrative commands (`DBCC`, `BACKUP`, `RESTORE`,
 * `SHUTDOWN`, `KILL`, …) that are easy to forget precisely because they are not
 * DML. One list serves both the read-only query screen and the WHERE screen so
 * the two cannot drift apart; a gap in either is a gap in both, which is how
 * `DBCC` slipped past a per-site list.
 *
 * `DISABLE`/`ENABLE` are here because `SELECT 1 DISABLE TRIGGER dbo.audit ON
 * dbo.users` is a valid semicolon-less batch that turns auditing off, and
 * `SET`/`BEGIN`/`COMMIT`/`ROLLBACK` because session and transaction state are
 * changed the same way (`SET IDENTITY_INSERT`, `SET ANSI_NULLS`). The rest of
 * that family — `SAVE TRANSACTION`, the symmetric/master key statements,
 * `ADD SIGNATURE`, and `RAISERROR ... WITH LOG` — opens with a word that is also
 * an ordinary identifier, so it is screened as a two-token phrase in
 * {@link MSSQL_STATEMENT_PHRASES} instead.
 *
 * The text statements `UPDATETEXT`, `WRITETEXT`, and `READTEXT` are listed in
 * their own right rather than left to `update`: there is no word boundary after
 * `update` in `UPDATETEXT`, so `\bupdate\b` never matches it and
 * `SELECT 1 UPDATETEXT dbo.t.col @ptr 0 NULL 'x'` would otherwise pass every
 * screen on the advertised read-only path. `READTEXT` reads rather than writes,
 * but it introduces a second statement in exactly the same semicolon-less way,
 * which is what this list exists to reject.
 *
 * `RENAME` is documented T-SQL DDL — it applies to Azure Synapse Analytics
 * dedicated SQL pools and Analytics Platform System, both of which speak TDS on
 * port 1433 and are reachable with exactly the connection fields this block
 * exposes. `SELECT 1 RENAME OBJECT dbo.Customer TO Customer1` is a valid
 * semicolon-less batch that changes schema through an operation advertised as
 * read-only, and `RENAME DATABASE` and `RENAME OBJECT … COLUMN … TO …` reach it
 * the same way.
 *
 * `RECEIVE` is the Service Broker read that *removes* the messages it returns,
 * so it is a write in everything but name. Its siblings — `END`/`MOVE`/`GET`
 * `CONVERSATION` and `SEND ON CONVERSATION` — open with words that are ordinary
 * identifiers (`END` closes every `CASE`), so they are screened as phrases in
 * {@link MSSQL_STATEMENT_PHRASES} instead.
 *
 * `FETCH` is deliberately **absent**: `OFFSET … FETCH NEXT` is the standard
 * T-SQL paging clause, so screening it would reject the ordinary paged SELECT
 * this operation exists to run. Word boundaries keep the additions off ordinary
 * identifiers — `settled`, `offset_value`, and `begin_date` all match nothing.
 * @see https://learn.microsoft.com/en-us/sql/t-sql/statements/statements
 */
const MSSQL_STATEMENT_KEYWORDS =
  /\b(?:insert|update|updatetext|writetext|readtext|delete|merge|drop|create|alter|truncate|rename|receive|disable|enable|set|begin|commit|rollback|grant|revoke|deny|exec|execute|backup|restore|shutdown|reconfigure|dbcc|kill|checkpoint|use|bulk|revert|setuser|openrowset|opendatasource|openquery|openxml|waitfor|into|deallocate)\b/i

/**
 * The remaining session, transaction, cursor, and key-management statements,
 * every one of which is a valid semicolon-less second statement the single-word
 * list above cannot carry.
 *
 * Each is matched as a **two-token** phrase rather than a bare word, because the
 * leading words are ordinary identifiers: `open` and `close` are columns in any
 * price table, `save` and `add` are common verbs, and `END` closes every `CASE`.
 * Screening those bare would reject the plain SELECTs this operation exists to
 * run. `DEALLOCATE` is the one exception and lives in the word list above — it
 * has no ordinary-identifier reading.
 *
 * Most of these write neither table data nor schema, which is why they were
 * missed; they are screened because the file's stated rule is that a second
 * statement is rejected structurally, not by what it happens to do.
 * `RAISERROR ... WITH LOG` writes to the error log and the Windows application
 * log, so it is not inert. The Service Broker conversation statements are not
 * inert either: `END CONVERSATION ... WITH CLEANUP` drops every message in a
 * conversation, `MOVE CONVERSATION` reassigns it, and `SEND ON CONVERSATION`
 * enqueues a message — and the handles they need are enumerable through this
 * same path, because the catalog screen applies only to WHERE clauses.
 * @see https://learn.microsoft.com/en-us/sql/t-sql/statements/end-conversation-transact-sql
 * @see https://learn.microsoft.com/en-us/sql/t-sql/statements/statements
 */
const MSSQL_STATEMENT_PHRASES: readonly RegExp[] = [
  /\bsave\s+tran(?:saction)?\b/i,
  /\bopen\s+(?:symmetric|master)\s+key\b/i,
  /\bclose\s+(?:all\s+symmetric\s+keys|master\s+key|symmetric\s+key)\b/i,
  /\badd\s+signature\b/i,
  /\braiserror[\s\S]*?\bwith\s+log\b/i,
  /\b(?:end|move|get)\s+conversation\b/i,
  /\bsend\s+on\s+conversation\b/i,
]

/** Matches the first screened statement phrase, or `null`. */
function matchStatementPhrase(masked: string): string | null {
  for (const pattern of MSSQL_STATEMENT_PHRASES) {
    const match = pattern.exec(masked)
    if (match) return match[0]
  }
  return null
}

/** Extended, OLE-automation, and system stored procedures, called with or without `EXEC`. */
const MSSQL_PROCEDURE_PATTERN = /\b(?:xp_|sp_)\w+/i

/**
 * Rejects a second statement in a batch.
 *
 * T-SQL treats the semicolon as optional, so this catches only the explicit
 * form; the keyword screen above is what catches the semicolon-less one. Run on
 * literal-masked text so a semicolon inside a quoted value is not a statement.
 */
const MSSQL_STACKED_STATEMENT = /;\s*\S/

/**
 * Rejects SQL comments in the read-only path.
 *
 * A block comment placed inside a keyword splits it as far as a lexical scan is
 * concerned, so no amount of keyword coverage helps if the server rejoins the
 * halves into one token. Rather than model how the server's tokenizer treats an
 * interior comment — which cannot be settled without a live instance — the
 * read-only path refuses comments outright. A SELECT submitted through this
 * operation has no need for one, and Execute Raw SQL still accepts them.
 *
 * {@link maskSqlStringLiterals} deliberately leaves comment markers intact, so
 * this still fires after masking while `'-- not a comment'` inside a literal
 * does not trip it.
 */
const MSSQL_COMMENT = /--|\/\*|\*\//

/**
 * A quote character {@link maskSqlStringLiterals} treats as opening a literal.
 * Backtick is included because the masker honours it even though T-SQL does not.
 */
const MSSQL_MASKER_QUOTES = ["'", '"', '`'] as const

/** A backslash directly before one of {@link MSSQL_MASKER_QUOTES}. */
const MSSQL_BACKSLASH_ESCAPED_QUOTE = /\\['"`]/

/** Any quote character inside a bracket-quoted identifier. */
const MSSQL_QUOTE_IN_BRACKETS = /\[[^\]]*['"`]/

/**
 * Rejects input whose quoting would make literal masking unreliable.
 *
 * Every screen below runs over {@link maskSqlStringLiterals} output, so anything
 * the masker hides is invisible to all of them — and the masker is written for
 * the ANSI/MySQL dialect, not T-SQL. Three ways to desynchronise it, each of
 * which lets real SQL hide inside what the masker believes is a string:
 *
 * 1. **An unpaired quote.** The masker runs to the end of the input looking for
 *    a partner, masking everything on the way.
 * 2. **A quote inside a bracketed identifier.** Brackets are SQL Server's other
 *    quoting form and the masker does not track them, so `[a"] = 1 OR 1=1`
 *    reads as one unterminated literal.
 * 3. **A backslash before a quote.** The masker treats `\` as an escape and
 *    swallows the quote that follows — but **T-SQL has no backslash escape**, so
 *    the server closes the literal there and executes the rest as code. This is
 *    the dangerous one, because it survives an even quote count:
 *    `a='x\' DELETE FROM dbo.t WHERE b='y'` holds four quotes and masks to
 *    `a=          y`, hiding the DELETE from the keyword screen entirely.
 *
 * All three are rejected rather than modelled. T-SQL escapes a quote by doubling
 * it and has no use for a backslash escape or a backtick, so nothing correct is
 * turned away except a value ending in a literal backslash (`'C:\'`) — which the
 * Execute Raw SQL operation still accepts. Failing closed here is what lets
 * every screen below trust that what the mask left visible is all the code there
 * is.
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers
 * @see https://learn.microsoft.com/en-us/sql/t-sql/data-types/constants-transact-sql
 */
function hasUnreliableQuoting(value: string): boolean {
  for (const quote of MSSQL_MASKER_QUOTES) {
    let count = 0
    for (const char of value) {
      if (char === quote) count++
    }
    if (count % 2 !== 0) return true
  }

  return MSSQL_BACKSLASH_ESCAPED_QUOTE.test(value) || MSSQL_QUOTE_IN_BRACKETS.test(value)
}

/**
 * Restricts the Query operation to statements that only read.
 *
 * The block label, the tool description, and the docs all present this
 * operation as SELECT-only, so it must not double as a second path to DML —
 * `mssql_execute` is the operation that accepts mutations. Without this an
 * agent choosing `mssql_query` because "it is only a SELECT" could delete rows.
 *
 * Four screens, deliberately layered so no single one has to be exhaustive: the
 * statement must open with `SELECT` (or a leading `WITH`, since a CTE is the
 * normal way to write a non-trivial SELECT); it may not contain a comment, which
 * would otherwise let a keyword be split in half; it may not contain a second
 * statement after a semicolon, which rejects `SELECT 1; <anything>` structurally
 * rather than by naming the anything; and it may not mention a
 * statement-introducing keyword or a stored procedure, which covers both the
 * semicolon-less batch and the `WITH x AS (...) DELETE FROM x` form that a
 * leading-token check alone would miss.
 *
 * All screening runs over literal-masked text, so ordinary prose in a WHERE
 * clause does not trip it. The screens are lexical rather than a parser, so a
 * query using a keyword as a bare identifier is rejected too — it fails closed,
 * and the Execute Raw SQL operation is the escape hatch.
 */
export function validateReadOnlyQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim()

  /**
   * `\b` rather than `\s`: T-SQL does not require whitespace after the keyword,
   * so `SELECT*FROM dbo.users` and `SELECT(1)` are valid reads that a
   * whitespace-anchored check would push to Execute Raw SQL for no reason. The
   * boundary still refuses `SELECTX`, and it cannot loosen the screen overall —
   * the keyword and batch checks below run on the whole statement regardless of
   * how it opens.
   */
  if (!/^(?:select|with)\b/i.test(trimmedQuery)) {
    return {
      isValid: false,
      error:
        'The Query operation only accepts SELECT statements, optionally led by a WITH clause. Use the Execute Raw SQL operation to run anything else.',
    }
  }

  if (hasUnreliableQuoting(trimmedQuery)) {
    return {
      isValid: false,
      error:
        'The Query operation could not read this statement reliably: it has an unpaired quote, a quote inside a bracketed identifier, or a backslash before a quote. T-SQL escapes a quote by doubling it.',
    }
  }

  const masked = maskSqlStringLiterals(trimmedQuery)

  if (MSSQL_COMMENT.test(masked)) {
    return {
      isValid: false,
      error:
        'The Query operation does not accept SQL comments, because a comment can split a keyword. Use the Execute Raw SQL operation if the statement needs one.',
    }
  }

  if (MSSQL_STACKED_STATEMENT.test(masked)) {
    return {
      isValid: false,
      error:
        'The Query operation runs a single SELECT statement. Use the Execute Raw SQL operation to run a batch.',
    }
  }

  const disallowed =
    MSSQL_STATEMENT_KEYWORDS.exec(masked)?.[0] ??
    MSSQL_PROCEDURE_PATTERN.exec(masked)?.[0] ??
    matchStatementPhrase(masked)
  if (disallowed) {
    return {
      isValid: false,
      error: `The Query operation cannot run ${disallowed.toUpperCase()}. Use the Execute Raw SQL operation for statements that modify data, schema, or server state.`,
    }
  }

  return { isValid: true }
}

/**
 * Restricts Execute Raw SQL to a statement kind the operation advertises.
 *
 * The anchor is `\b` rather than `\s`, matching the read-only screen, because
 * T-SQL does not require whitespace after the opening keyword: `EXEC(@sql)` is
 * the ordinary way to run dynamic SQL and `SELECT(1)` is a valid read, both of
 * which a whitespace anchor refused on the one operation meant to accept them.
 * `EXECUTE x` still matches — the alternation backtracks from `exec` to
 * `execute` when the boundary fails — and `SELECTX` is still refused.
 *
 * This is a statement-kind check, not a security screen. Execute Raw SQL is the
 * deliberate escape hatch: the caller supplies their own credentials, so the
 * boundary is what those credentials may do, not what this pattern matches.
 */
export function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim()

  const allowedStatements = /^(select|insert|update|delete|with|merge|exec|execute|declare)\b/i
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
 * Rejects `SELECT` inside an update or delete WHERE clause.
 *
 * `SELECT` cannot live in the shared {@link MSSQL_STATEMENT_KEYWORDS} list, since
 * the read-only query screen exists to *permit* it — but appended to a WHERE it
 * is an exfiltration channel: `id = 1 SELECT secret FROM dbo.credentials` runs
 * as a second statement and the route hands back its recordset as though it were
 * the mutation's result.
 *
 * The cost is that a subquery condition (`id IN (SELECT ...)`) is refused here.
 * That is a deliberate trade — the WHERE text is interpolated rather than bound,
 * so the screen cannot tell a subquery from an appended statement, and the
 * Execute Raw SQL operation covers a subquery-driven update.
 */
const MSSQL_WHERE_SELECT = /\bselect\b/i

/**
 * SQL Server catalog surfaces a WHERE clause has no business reading: the
 * information schema, the `sys.*` catalog views, and the legacy compatibility
 * views still reachable as `master..sysobjects`.
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/catalog-views-transact-sql
 */
/**
 * Constant tautologies the shared guard's `OR <literal>` rule cannot see because
 * a parenthesis or a `NOT` sits between the operator and the constant —
 * `OR (1)`, `OR ((1))`, `OR NOT 0`, `OR NOT (FALSE)`.
 *
 * Both patterns require the constant to be the *whole* parenthesised term, so a
 * real disjunct is untouched: `OR (1 = priority)` does not match, because a
 * closing paren does not follow the digit.
 *
 * This narrows the gap; it does not close it, and it is not meant to. An
 * always-true expression cannot be recognised lexically in general —
 * `OR 2 > 1`, `OR LEN(x) >= 0`, and `OR id IS NOT NULL` all survive any pattern
 * list — which is why {@link validateWhereClause} is documented as
 * defense-in-depth rather than a boundary.
 */
const MSSQL_WHERE_CONSTANT_TAUTOLOGY: readonly RegExp[] = [
  /\bor\s+(?:not\s+)*\(+\s*(?:\d+(?:\.\d+)?|true|false)\s*\)+/i,
  /\bor\s+not\s+(?:\d+(?:\.\d+)?|true|false)\b/i,
]

const MSSQL_CATALOG_PATTERNS: readonly RegExp[] = [
  /information_schema/i,
  /\bsys\./i,
  /\.\.\s*sys\w*/i,
  /\bsys(?:objects|columns|databases|users|indexes|comments)\b/i,
]

/**
 * Rejects WHERE clauses containing injection or always-true tautology patterns
 * so a user-supplied condition cannot broaden an update or delete to every row.
 *
 * Delegates the shared checks to {@link validateSqlWhereClause} — which masks
 * string literals before scanning, so prose inside a quoted value cannot trip a
 * structural pattern — then adds the two things it cannot know about.
 *
 * The first is the one that does not generalize: **T-SQL does not require a
 * statement terminator**, so `id = 1 DBCC SHRINKDATABASE('db')` is a valid
 * two-statement batch and every semicolon-anchored stacked-query check, the
 * shared guard's included, reads straight past it. That is why the screen is
 * {@link MSSQL_STATEMENT_KEYWORDS} — the same list the read-only query screen
 * uses, so a keyword can never be covered in one place and missed in the other.
 * Word boundaries keep ordinary column names (`updated_at`, `deleted_at`,
 * `created_by`) matching nothing; a column whose name *is* a bare keyword has
 * to be reached through the Execute Raw SQL operation. The second is the
 * catalog surface above, plus the `xp_`/`sp_` procedures.
 *
 * As the shared guard's own documentation states, this is defense-in-depth
 * rather than a security boundary: the caller supplies their own database
 * credentials and can run equivalent SQL through the Execute Raw SQL operation.
 * It stops the easy ways an injected condition escalates, nothing more.
 * @throws {Error} If the WHERE clause matches any screened pattern
 */
function validateWhereClause(where: string): void {
  if (hasUnreliableQuoting(where)) {
    throw new Error(
      'WHERE clause has an unpaired quote, a quote inside a bracketed identifier, or a backslash before a quote. T-SQL escapes a quote by doubling it.'
    )
  }

  const shared = validateSqlWhereClause(where, 'WHERE clause')
  if (!shared.isValid) {
    throw new Error(shared.error)
  }

  const masked = maskSqlStringLiterals(where)
  if (
    MSSQL_STATEMENT_KEYWORDS.test(masked) ||
    matchStatementPhrase(masked) !== null ||
    MSSQL_PROCEDURE_PATTERN.test(masked) ||
    MSSQL_WHERE_SELECT.test(masked) ||
    MSSQL_WHERE_CONSTANT_TAUTOLOGY.some((pattern) => pattern.test(masked)) ||
    MSSQL_CATALOG_PATTERNS.some((pattern) => pattern.test(masked))
  ) {
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
        schema: string
        table: string
        column: string
      }
    }>
    primaryKey: string[]
    foreignKeys: Array<{
      column: string
      referencesSchema: string
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
  TABLE_NAME: string
  COLUMN_NAME: string
  DATA_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
}

interface KeyColumnRow {
  TABLE_NAME: string
  COLUMN_NAME: string
}

interface ForeignKeyRow {
  TABLE_NAME: string
  COLUMN_NAME: string
  REFERENCED_TABLE_SCHEMA: string
  REFERENCED_TABLE_NAME: string
  REFERENCED_COLUMN_NAME: string
}

interface IndexRow {
  TABLE_NAME: string
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

  const tableRows = tablesResult.recordset as TableRow[]
  if (tableRows.length === 0) return { tables: [], schemas }

  /**
   * The column, primary key, foreign key, and index reads below are filtered by
   * schema and grouped in memory, rather than run once per table. Per-table they
   * were four round trips each — a 500-table schema meant ~2,000 sequential
   * queries, every one under its own connection timeout.
   */
  const columnsResult = await pool
    .request()
    .input('schema', schemaName)
    .query<ColumnRow>(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
    )

  const pkResult = await pool
    .request()
    .input('schema', schemaName)
    .query<KeyColumnRow>(
      `SELECT tc.TABLE_NAME, kcu.COLUMN_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
       AND tc.TABLE_SCHEMA = @schema
     ORDER BY tc.TABLE_NAME, kcu.ORDINAL_POSITION`
    )

  const fkResult = await pool
    .request()
    .input('schema', schemaName)
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
         pt.name AS TABLE_NAME,
         pc.name AS COLUMN_NAME,
         rs.name AS REFERENCED_TABLE_SCHEMA,
         rt.name AS REFERENCED_TABLE_NAME,
         rc.name AS REFERENCED_COLUMN_NAME
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
       JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
       JOIN sys.columns pc
         ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
       JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
       JOIN sys.columns rc
         ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE ps.name = @schema
       ORDER BY pt.name, fk.name, fkc.constraint_column_id`
    )

  const indexResult = await pool
    .request()
    .input('schema', schemaName)
    .query<IndexRow>(
      /**
       * `key_ordinal > 0` restricts the result to key columns: it is the
       * "ordinal (1-based) within set of key-columns", and `0` marks INCLUDEd
       * non-key columns, partitioning columns, **and every column of an XML,
       * spatial, columnstore, or JSON index**. The partitioning columns are
       * why `is_included_column` alone is not enough — those report `0` for it
       * too. The index families are the cost of the filter: they contribute no
       * key column, so they are absent from the result rather than listed with
       * an empty column set. Rowstore keys, which is what a query planner
       * reader is after, are reported in full.
       *
       * `is_hypothetical = 0` drops the statistics-only indexes the Database
       * Engine Tuning Advisor leaves behind ("can't be used directly as a data
       * access path"), and `is_disabled = 0` drops indexes that exist but are
       * not maintained. Reporting either as a live index misleads.
       *
       * `is_primary_key = 0` keeps the primary key out, since `primaryKey`
       * carries it already. A UNIQUE *constraint* is deliberately left in: it
       * is a unique index and nothing else in the result reports it.
       * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-index-columns-transact-sql
       * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-indexes-transact-sql
       */
      `SELECT t.name AS TABLE_NAME, i.name AS INDEX_NAME, c.name AS COLUMN_NAME,
              i.is_unique AS IS_UNIQUE
       FROM sys.indexes i
       JOIN sys.index_columns ic
         ON i.object_id = ic.object_id AND i.index_id = ic.index_id
       JOIN sys.columns c
         ON ic.object_id = c.object_id AND ic.column_id = c.column_id
       JOIN sys.tables t ON i.object_id = t.object_id
       JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = @schema
         AND i.is_primary_key = 0
         AND i.is_hypothetical = 0
         AND i.is_disabled = 0
         AND i.name IS NOT NULL
         AND ic.key_ordinal > 0
       ORDER BY t.name, i.name, ic.key_ordinal`
    )

  /** Groups rows by their `TABLE_NAME`, preserving each group's server order. */
  function groupByTable<TRow extends { TABLE_NAME: string }>(rows: TRow[]): Map<string, TRow[]> {
    const grouped = new Map<string, TRow[]>()
    for (const row of rows) {
      const existing = grouped.get(row.TABLE_NAME)
      if (existing) existing.push(row)
      else grouped.set(row.TABLE_NAME, [row])
    }
    return grouped
  }

  const columnsByTable = groupByTable(columnsResult.recordset as ColumnRow[])
  const pkByTable = groupByTable(pkResult.recordset as KeyColumnRow[])
  const fkByTable = groupByTable(fkResult.recordset as ForeignKeyRow[])
  const indexRowsByTable = groupByTable(indexResult.recordset as IndexRow[])

  const tables: MSSQLIntrospectionResult['tables'] = []

  for (const tableRow of tableRows) {
    const tableName = tableRow.TABLE_NAME
    const tableSchema = tableRow.TABLE_SCHEMA

    const primaryKeyColumns = (pkByTable.get(tableName) ?? []).map((row) => row.COLUMN_NAME)

    const foreignKeys = (fkByTable.get(tableName) ?? []).map((row) => ({
      column: row.COLUMN_NAME,
      referencesSchema: row.REFERENCED_TABLE_SCHEMA,
      referencesTable: row.REFERENCED_TABLE_NAME,
      referencesColumn: row.REFERENCED_COLUMN_NAME,
    }))

    const fkByColumn = new Map<string, (typeof foreignKeys)[number]>()
    for (const fk of foreignKeys) {
      if (!fkByColumn.has(fk.column)) fkByColumn.set(fk.column, fk)
    }

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexRowsByTable.get(tableName) ?? []) {
      const indexName = row.INDEX_NAME
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, { name: indexName, columns: [], unique: Boolean(row.IS_UNIQUE) })
      }
      indexMap.get(indexName)!.columns.push(row.COLUMN_NAME)
    }
    const indexes = Array.from(indexMap.values())

    const primaryKeySet = new Set(primaryKeyColumns)

    const columns = (columnsByTable.get(tableName) ?? []).map((col) => {
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
            schema: fk.referencesSchema,
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
