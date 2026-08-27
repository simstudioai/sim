/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveHostAddresses, mockConnectionPool, mockConnect, mockClose } = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn().mockResolvedValue(undefined)
  const pool = vi.fn(function ConnectionPool(this: Record<string, unknown>) {
    this.connect = connect
    this.close = close
  })
  return {
    mockResolveHostAddresses: vi.fn(),
    mockConnectionPool: pool,
    mockConnect: connect,
    mockClose: close,
  }
})

vi.mock('mssql', () => ({
  default: { ConnectionPool: mockConnectionPool },
  ConnectionPool: mockConnectionPool,
}))

/**
 * Only DNS is stubbed. The SSRF guard and the shared WHERE screens stay real, so
 * these tests exercise the same masking behavior production does — which is the
 * point, since the bypasses below are a property of that masker.
 */
vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: mockResolveHostAddresses,
  preferIpv4: (addresses: string[]) => addresses[0],
}))

import {
  buildDeleteQuery,
  buildInsertQuery,
  buildUpdateQuery,
  createMSSQLConnection,
  executeIntrospect,
  executeQuery,
  type MSSQLConnectionConfig,
  toRowsResponseBody,
  validateQuery,
  validateReadOnlyQuery,
} from '@/app/api/tools/mssql/utils'

function makeConfig(overrides: Partial<MSSQLConnectionConfig> = {}): MSSQLConnectionConfig {
  return {
    host: 'db.example.com',
    port: 1433,
    database: 'app',
    username: 'app',
    password: 'secret',
    encrypt: 'enabled',
    trustServerCertificate: 'disabled',
    connectionTimeout: 15000,
    ...overrides,
  }
}

describe('validateReadOnlyQuery', () => {
  it('accepts an ordinary SELECT and a leading CTE', () => {
    expect(validateReadOnlyQuery('SELECT TOP (10) * FROM dbo.users').isValid).toBe(true)
    expect(
      validateReadOnlyQuery('WITH t AS (SELECT id FROM dbo.users) SELECT * FROM t').isValid
    ).toBe(true)
  })

  /** T-SQL does not require whitespace after the opening keyword. */
  it.each(['SELECT*FROM dbo.users', 'SELECT(1)', 'WITH(x) AS (SELECT 1) SELECT * FROM x'])(
    'accepts %s, which has no space after the keyword',
    (query) => {
      expect(validateReadOnlyQuery(query).isValid).toBe(true)
    }
  )

  it('still rejects a keyword that merely starts with SELECT', () => {
    expect(validateReadOnlyQuery('SELECTX FROM dbo.users').isValid).toBe(false)
  })

  it('accepts a SELECT whose literal contains a doubled quote', () => {
    expect(validateReadOnlyQuery("SELECT * FROM dbo.users WHERE name = 'O''Brien'").isValid).toBe(
      true
    )
  })

  it.each([
    ['a bare mutation', 'DELETE FROM dbo.users'],
    ['a semicolon batch', 'SELECT 1; DROP TABLE dbo.users'],
    ['a semicolon-less batch', 'SELECT 1 DELETE FROM dbo.users'],
    ['a CTE-led mutation', 'WITH t AS (SELECT id FROM dbo.users) DELETE FROM t'],
    ['a comment', 'SELECT 1 -- DELETE FROM dbo.users'],
    ['a stored procedure', 'SELECT 1 FROM dbo.t WHERE x = 1 xp_cmdshell'],
  ])('rejects %s', (_label, query) => {
    expect(validateReadOnlyQuery(query).isValid).toBe(false)
  })

  /**
   * The shared masker treats `\` as a literal escape because it was written for
   * the MySQL dialect. T-SQL has no backslash escape, so the server closes the
   * literal at the quote the masker swallowed and runs the remainder as code —
   * with an even quote count, so a parity check alone does not catch it.
   */
  it('rejects a backslash-escaped quote that would hide a mutation from the keyword screen', () => {
    const smuggled = String.raw`SELECT * FROM dbo.t WHERE a='x\' DELETE FROM dbo.t WHERE b='y'`

    const result = validateReadOnlyQuery(smuggled)

    expect(result.isValid).toBe(false)
    expect(result.error).toMatch(/backslash before a quote/)
  })

  it('rejects a quote inside a bracketed identifier', () => {
    expect(validateReadOnlyQuery(`SELECT * FROM dbo.t WHERE [a"] = 1 OR 1=1`).isValid).toBe(false)
    expect(validateReadOnlyQuery(`SELECT * FROM dbo.t WHERE [a'] = 1 OR 1=1`).isValid).toBe(false)
  })

  it('rejects an unpaired quote', () => {
    expect(validateReadOnlyQuery(`SELECT * FROM dbo.t WHERE a = 'x`).isValid).toBe(false)
  })

  /** Semicolon-less batches that change trigger, session, or transaction state. */
  it.each([
    'SELECT 1 DISABLE TRIGGER dbo.audit_trigger ON dbo.users',
    'SELECT 1 ENABLE TRIGGER dbo.audit_trigger ON dbo.users',
    'SELECT 1 SET IDENTITY_INSERT dbo.t ON',
    'SELECT 1 BEGIN TRAN',
    'SELECT 1 COMMIT',
    'SELECT 1 ROLLBACK',
  ])('rejects the state-changing batch %s', (query) => {
    expect(validateReadOnlyQuery(query).isValid).toBe(false)
  })

  /**
   * `\bupdate\b` cannot match `UPDATETEXT` — there is no word boundary after
   * `update` — so each text statement has to be screened in its own right.
   */
  it.each([
    "SELECT 1 UPDATETEXT dbo.t.col @ptr 0 NULL 'x'",
    "SELECT 1 WRITETEXT dbo.t.col @ptr 'x'",
    'SELECT 1 READTEXT dbo.t.col @ptr 0 16',
  ])('rejects the text statement batch %s', (query) => {
    expect(validateReadOnlyQuery(query).isValid).toBe(false)
  })

  /** The same statements reached through the WHERE screen, which shares the list. */
  it.each([
    "id = 1 UPDATETEXT dbo.t.col @ptr 0 NULL 'x'",
    "id = 1 WRITETEXT dbo.t.col @ptr 'x'",
    'id = 1 READTEXT dbo.t.col @ptr 0 16',
  ])('rejects the text statement %s in a WHERE clause', (where) => {
    expect(() => buildDeleteQuery('dbo.users', where)).toThrow()
  })

  /**
   * The guard against over-screening. `FETCH` is excluded from the keyword list
   * because `OFFSET … FETCH NEXT` is the standard paging clause, and the added
   * keywords must not catch ordinary identifiers that merely contain them.
   */
  it.each([
    'SELECT * FROM dbo.users ORDER BY id OFFSET 10 ROWS FETCH NEXT 20 ROWS ONLY',
    'WITH p AS (SELECT id FROM dbo.o) SELECT * FROM p ORDER BY id OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY',
    'SELECT settled, offset_value, begin_date FROM dbo.t',
    'SELECT updatetext_id, writetext_flag, readtext_offset FROM dbo.t',
    'SELECT TOP (100) id, name FROM dbo.users WHERE is_active = 1',
  ])('still accepts the legitimate read %s', (query) => {
    expect(validateReadOnlyQuery(query).isValid).toBe(true)
  })
})

describe('validateQuery (Execute Raw SQL)', () => {
  /** T-SQL needs no space after the keyword; `EXEC(@sql)` is ordinary dynamic SQL. */
  it.each([
    'EXEC(@sql)',
    'EXECUTE(@sql)',
    'EXEC sp_who',
    'EXECUTE dbo.myproc',
    'SELECT(1)',
    'WITH(x) AS (SELECT 1) SELECT * FROM x',
    'DECLARE @x INT',
  ])('accepts %s', (query) => {
    expect(validateQuery(query).isValid).toBe(true)
  })

  it.each(['SELECTX 1', 'DROP TABLE dbo.t', 'TRUNCATE TABLE dbo.t'])('rejects %s', (query) => {
    expect(validateQuery(query).isValid).toBe(false)
  })
})

describe('buildUpdateQuery / buildDeleteQuery WHERE screening', () => {
  it('builds a parameterized statement for an ordinary condition', () => {
    const { query, values } = buildUpdateQuery('dbo.users', { name: 'Jane' }, 'id = 1')

    expect(query).toBe('UPDATE [dbo].[users] SET [name] = @param1 WHERE id = 1')
    expect(values).toEqual(['Jane'])
  })

  /**
   * Same masker desynchronisation as above, reached through the mutation path:
   * an even quote count, no semicolon, and the tautology invisible to every
   * screen that runs over masked text.
   */
  it('rejects a backslash-escaped quote that would hide a tautology', () => {
    const smuggled = String.raw`id = 'a\' OR 1=1 OR 2>1 AND b = 'x'`

    expect(() => buildDeleteQuery('dbo.users', smuggled)).toThrow(/backslash before a quote/)
    expect(() => buildUpdateQuery('dbo.users', { a: 1 }, smuggled)).toThrow(
      /backslash before a quote/
    )
  })

  it('rejects a quote hidden inside a bracketed identifier', () => {
    expect(() => buildDeleteQuery('dbo.users', `[a"] = 1 OR 1=1`)).toThrow(/bracketed identifier/)
  })

  /**
   * The shared guard sees `OR 1` but not a parenthesised or negated constant.
   * These are the specific forms it documents as undetected; the class as a
   * whole is not lexically decidable, so this narrows rather than closes it.
   */
  it.each([
    'id = 1 OR (1)',
    'id = 1 OR ((1))',
    'id = 1 OR NOT 0',
    'id = 1 OR NOT (0)',
    'id = 1 OR (TRUE)',
  ])('rejects the constant tautology %s', (where) => {
    expect(() => buildDeleteQuery('dbo.users', where)).toThrow()
  })

  it.each([
    'id = 1 OR (priority = 2)',
    'id = 1 OR (1 = priority)',
    "status = 'open' OR (retries < 3)",
  ])('still accepts the real disjunct %s', (where) => {
    expect(() => buildDeleteQuery('dbo.users', where)).not.toThrow()
  })

  it.each([
    ['a semicolon-less batch', "id = 1 DBCC SHRINKDATABASE('app')"],
    ['an appended SELECT', 'id = 1 SELECT secret FROM dbo.credentials'],
    ['a catalog probe', 'id = 1 AND EXISTS (sys.objects)'],
    ['a stored procedure', 'id = 1 AND xp_cmdshell'],
  ])('rejects %s', (_label, where) => {
    expect(() => buildDeleteQuery('dbo.users', where)).toThrow()
  })
})

describe('identifier handling', () => {
  it('bracket-quotes every part of a qualified name and binds values', () => {
    const { query, values } = buildInsertQuery('dbo.users', { name: 'Jane', age: 30 })

    expect(query).toBe('INSERT INTO [dbo].[users] ([name], [age]) VALUES (@param1, @param2)')
    expect(values).toEqual(['Jane', 30])
  })

  it('rejects an identifier that is not a plain word', () => {
    expect(() => buildInsertQuery('users; DROP TABLE x', { a: 1 })).toThrow(/Invalid identifier/)
    expect(() => buildInsertQuery('users', { 'a b': 1 })).toThrow(/Invalid identifier/)
  })

  it('cannot be escaped by pre-closing a bracket', () => {
    expect(() => buildInsertQuery('users] DROP TABLE x --[', { a: 1 })).toThrow(
      /Invalid identifier/
    )
  })
})

describe('executeQuery parameter binding', () => {
  function makePool(recordset: unknown[] = [], rowsAffected: number[] = [0]) {
    const input = vi.fn()
    const query = vi.fn().mockResolvedValue({ recordset, rowsAffected })
    return {
      pool: { request: () => ({ input, query }) } as never,
      input,
      query,
    }
  }

  it('binds every value positionally, never interpolating it', async () => {
    const { pool, input, query } = makePool()

    await executeQuery(pool, 'INSERT INTO [dbo].[t] ([a]) VALUES (@param1)', ["'; DROP TABLE t --"])

    expect(query).toHaveBeenCalledWith('INSERT INTO [dbo].[t] ([a]) VALUES (@param1)')
    expect(input).toHaveBeenCalledWith('param1', "'; DROP TABLE t --")
  })

  /**
   * node-mssql infers NVarChar for an unrecognised object and tedious then
   * rejects it with a bare `Invalid string.`, so a nested JSON value has to be
   * serialized before it reaches the driver.
   */
  it('serializes nested objects and arrays, passing scalars and Dates through', async () => {
    const { pool, input } = makePool()
    const when = new Date('2020-01-01T00:00:00Z')

    await executeQuery(pool, 'INSERT INTO [dbo].[t] VALUES (@param1, @param2, @param3, @param4)', [
      { nested: true },
      ['a', 'b'],
      when,
      42,
    ])

    expect(input).toHaveBeenNthCalledWith(1, 'param1', '{"nested":true}')
    expect(input).toHaveBeenNthCalledWith(2, 'param2', '["a","b"]')
    expect(input).toHaveBeenNthCalledWith(3, 'param3', when)
    expect(input).toHaveBeenNthCalledWith(4, 'param4', 42)
  })

  it('reports affected rows when the statement returns no recordset', async () => {
    const { pool } = makePool([], [3])

    await expect(
      executeQuery(pool, 'DELETE FROM [dbo].[t] WHERE id = @param1', [1])
    ).resolves.toEqual({ rows: [], rowCount: 3 })
  })
})

describe('createMSSQLConnection DNS pinning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockResolveHostAddresses.mockResolvedValue({
      addresses: ['93.184.216.34'],
      preferred: '93.184.216.34',
    })
  })

  it('never opens a connection when the host cannot be resolved (no SSRF window)', async () => {
    mockResolveHostAddresses.mockRejectedValue(new Error('ENOTFOUND'))

    await expect(
      createMSSQLConnection(makeConfig({ host: 'rebind.attacker.example' }))
    ).rejects.toThrow(/could not be resolved/)
    expect(mockConnectionPool).not.toHaveBeenCalled()
  })

  it('keeps the hostname as `server` so TLS SNI and certificate validation still apply', async () => {
    await createMSSQLConnection(makeConfig({ host: 'rebind.attacker.example' }))

    expect(mockResolveHostAddresses).toHaveBeenCalledWith('rebind.attacker.example')
    const config = mockConnectionPool.mock.calls[0][0]
    expect(config.server).toBe('rebind.attacker.example')
  })

  it('routes the socket through a connector bound to the validated IP, not the hostname', async () => {
    await createMSSQLConnection(makeConfig({ host: 'rebind.attacker.example' }))

    const config = mockConnectionPool.mock.calls[0][0]
    expect(typeof config.options.connector).toBe('function')
    expect(config.options.instanceName).toBeUndefined()
  })

  /**
   * Only a pool that is handed back reaches the route's `finally`, so a pool
   * whose connect rejected has to release itself or a bad credential retried in
   * a loop leaks one per attempt.
   */
  it('closes the pool and surfaces the original error when connect fails', async () => {
    mockConnect.mockRejectedValue(new Error('Login failed for user'))

    await expect(createMSSQLConnection(makeConfig())).rejects.toThrow('Login failed for user')
    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('does not let a close failure mask the connect error', async () => {
    mockConnect.mockRejectedValue(new Error('Login failed for user'))
    mockClose.mockRejectedValue(new Error('close blew up'))

    await expect(createMSSQLConnection(makeConfig())).rejects.toThrow('Login failed for user')
  })

  it('leaves the pool open on success so the route controls its lifetime', async () => {
    await createMSSQLConnection(makeConfig())

    expect(mockClose).not.toHaveBeenCalled()
  })

  it('maps the string toggles onto driver booleans without coercing "disabled" to true', async () => {
    await createMSSQLConnection(
      makeConfig({ encrypt: 'disabled', trustServerCertificate: 'enabled' })
    )

    const config = mockConnectionPool.mock.calls[0][0]
    expect(config.options.encrypt).toBe(false)
    expect(config.options.trustServerCertificate).toBe(true)
  })
})

describe('read-only screens cover the rest of the session and transaction family', () => {
  /**
   * Each is a valid semicolon-less second statement, and the file's stated rule
   * is that a second statement is rejected structurally rather than by what it
   * happens to do.
   */
  it.each([
    ['SAVE TRANSACTION', 'SELECT 1 SAVE TRANSACTION sp1'],
    ['SAVE TRAN', 'SELECT 1 SAVE TRAN sp1'],
    ['OPEN SYMMETRIC KEY', 'SELECT 1 OPEN SYMMETRIC KEY k DECRYPTION BY CERTIFICATE c'],
    ['OPEN MASTER KEY', "SELECT 1 OPEN MASTER KEY DECRYPTION BY PASSWORD = 'p'"],
    ['CLOSE ALL SYMMETRIC KEYS', 'SELECT 1 CLOSE ALL SYMMETRIC KEYS'],
    ['CLOSE MASTER KEY', 'SELECT 1 CLOSE MASTER KEY'],
    ['DEALLOCATE', 'SELECT 1 DEALLOCATE cur'],
    ['ADD SIGNATURE', 'SELECT 1 ADD SIGNATURE TO dbo.p BY CERTIFICATE c'],
    ['RAISERROR WITH LOG', "SELECT 1 RAISERROR ('boom', 16, 1) WITH LOG"],
  ])('rejects %s in the Query operation', (_label, query) => {
    expect(validateReadOnlyQuery(query).isValid).toBe(false)
  })

  it.each([
    ['SAVE TRANSACTION', 'id = 1 SAVE TRANSACTION sp1'],
    ['OPEN SYMMETRIC KEY', 'id = 1 OPEN SYMMETRIC KEY k DECRYPTION BY CERTIFICATE c'],
    ['CLOSE ALL SYMMETRIC KEYS', 'id = 1 CLOSE ALL SYMMETRIC KEYS'],
    ['DEALLOCATE', 'id = 1 DEALLOCATE cur'],
    ['ADD SIGNATURE', 'id = 1 ADD SIGNATURE TO dbo.p BY CERTIFICATE c'],
    ['RAISERROR WITH LOG', "id = 1 RAISERROR ('boom', 16, 1) WITH LOG"],
  ])('rejects %s in an update or delete WHERE clause', (_label, where) => {
    expect(() => buildUpdateQuery('t', { a: 1 }, where)).toThrow()
    expect(() => buildDeleteQuery('t', where)).toThrow()
  })

  /**
   * The over-screening guard. `open`, `close`, `save`, and `add` are ordinary
   * column names (a price table has all four), so a bare-word screen would make
   * the plain SELECTs this operation exists to run un-runnable.
   */
  it('still accepts ordinary identifiers that start with a screened phrase word', () => {
    const allowed = [
      'SELECT open, close, high, low FROM dbo.prices',
      'SELECT close FROM dbo.prices WHERE open > 10',
      'SELECT save_id, add_on, open_date, close_date FROM dbo.orders',
      'SELECT o.open, o.close FROM dbo.ohlc o ORDER BY o.open DESC',
    ]

    for (const query of allowed) {
      expect(validateReadOnlyQuery(query)).toEqual({ isValid: true })
    }

    expect(() => buildUpdateQuery('prices', { close: 2 }, 'open > 10')).not.toThrow()
    expect(() => buildDeleteQuery('prices', 'close < 1 AND open_date > 0')).not.toThrow()
  })
})

describe('read-only screens cover RENAME and the Service Broker statement family', () => {
  /**
   * `RENAME` is documented T-SQL DDL for Azure Synapse dedicated SQL pools and
   * Analytics Platform System, both reachable over TDS with the connection
   * fields this block exposes — so a schema change was passing an operation
   * advertised as read-only.
   */
  it.each([
    ['RENAME OBJECT', 'SELECT 1 RENAME OBJECT dbo.Customer TO Customer1'],
    ['RENAME OBJECT COLUMN', 'SELECT 1 RENAME OBJECT dbo.t COLUMN c1 TO c2'],
    ['RENAME DATABASE', 'SELECT 1 RENAME DATABASE db1 TO db2'],
    ['RECEIVE', 'SELECT 1 RECEIVE TOP(1) * FROM dbo.MyQueue'],
    ['END CONVERSATION', "SELECT 1 END CONVERSATION '00000000-0000-0000-0000-000000000000'"],
    [
      'MOVE CONVERSATION',
      "SELECT 1 MOVE CONVERSATION '00000000-0000-0000-0000-000000000000' TO '00000000-0000-0000-0000-000000000001'",
    ],
    ['GET CONVERSATION GROUP', 'SELECT 1 GET CONVERSATION GROUP @g FROM dbo.MyQueue'],
    [
      'SEND ON CONVERSATION',
      "SELECT 1 SEND ON CONVERSATION '00000000-0000-0000-0000-000000000000' MESSAGE TYPE [t] ('x')",
    ],
  ])('rejects %s in the Query operation', (_label, query) => {
    expect(validateReadOnlyQuery(query).isValid).toBe(false)
  })

  it.each([
    ['RENAME OBJECT', 'id = 1 RENAME OBJECT dbo.t TO t2'],
    ['RECEIVE', 'id = 1 RECEIVE TOP(1) * FROM dbo.MyQueue'],
    ['END CONVERSATION', "id = 1 END CONVERSATION '00000000-0000-0000-0000-000000000000'"],
    ['GET CONVERSATION GROUP', 'id = 1 GET CONVERSATION GROUP @g FROM dbo.MyQueue'],
  ])('rejects %s in an update or delete WHERE clause', (_label, where) => {
    expect(() => buildUpdateQuery('t', { a: 1 }, where)).toThrow()
    expect(() => buildDeleteQuery('t', where)).toThrow()
  })

  /**
   * The over-screening guard. `END` closes every `CASE`, and `rename`/`receive`
   * are the stems of ordinary column names, so neither addition may cost the
   * plain SELECTs this operation exists to run.
   */
  it('still accepts CASE … END and ordinary identifiers built on the new words', () => {
    const allowed = [
      "SELECT CASE WHEN status = 1 THEN 'on' ELSE 'off' END FROM dbo.jobs",
      "SELECT CASE WHEN a = 1 THEN 'x' END AS conversation_state FROM dbo.t",
      'SELECT renamed_at, rename_log, received_at, receive_queue FROM dbo.audit',
      'SELECT conversation_id, get_flag, move_order, send_at, end_date FROM dbo.t',
    ]

    for (const query of allowed) {
      expect(validateReadOnlyQuery(query)).toEqual({ isValid: true })
    }

    expect(() => buildUpdateQuery('audit', { a: 1 }, 'renamed_at > 0')).not.toThrow()
    expect(() => buildDeleteQuery('audit', 'received_at > 0 AND conversation_id = 3')).not.toThrow()
  })
})

describe('executeQuery result caps', () => {
  function makeCapPool(recordset: unknown[]) {
    return {
      request: () => ({
        input: vi.fn(),
        query: vi.fn().mockResolvedValue({ recordset, rowsAffected: [0] }),
      }),
    } as never
  }

  it('caps the recordset at the row ceiling and says so', async () => {
    const result = await executeQuery(
      makeCapPool(Array.from({ length: 10_001 }, (_, i) => ({ i }))),
      'SELECT 1'
    )

    expect(result.rows).toHaveLength(10_000)
    expect(result.rowCount).toBe(10_000)
    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toMatch(/OFFSET/)
  })

  it('caps on bytes even when the row count is small', async () => {
    // 20 rows of ~1MB each: well under the row ceiling, well over the byte one.
    const fat = Array.from({ length: 20 }, () => ({ blob: 'x'.repeat(1024 * 1024) }))
    const result = await executeQuery(makeCapPool(fat), 'SELECT 1')

    expect(result.rows.length).toBeLessThan(20)
    expect(result.truncated).toBe(true)
  })

  it('leaves an ordinary result untouched', async () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const result = await executeQuery(makeCapPool(rows), 'SELECT 1')

    expect(result.rows).toEqual(rows)
    expect(result.truncated).toBeUndefined()
    expect(result.truncationReason).toBeUndefined()
  })

  it('never serializes past the byte ceiling', async () => {
    const fat = Array.from({ length: 20 }, () => ({ blob: 'x'.repeat(1024 * 1024) }))
    const result = await executeQuery(makeCapPool(fat), 'SELECT 1')

    expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it('drops a lone row that is larger than the byte ceiling rather than admitting it', async () => {
    const oversized = [{ blob: 'x'.repeat(11 * 1024 * 1024) }]
    const result = await executeQuery(makeCapPool(oversized), 'SELECT 1')

    expect(result.rows).toEqual([])
    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toMatch(/exceeds the 10 MB response ceiling/)
  })

  /**
   * `String.length` counts UTF-16 code units and the response is emitted as
   * UTF-8, so a CJK recordset costs three bytes for every unit the old
   * accounting charged one for. Measured with `length` these rows fit; measured
   * as the bytes that actually go on the wire they are ~3x over.
   */
  it('bounds a multibyte recordset by UTF-8 bytes, not UTF-16 code units', async () => {
    const cjk = Array.from({ length: 20 }, () => ({ blob: '世'.repeat(1024 * 1024) }))
    const result = await executeQuery(makeCapPool(cjk), 'SELECT 1')

    expect(Buffer.byteLength(JSON.stringify(result.rows), 'utf8')).toBeLessThanOrEqual(
      10 * 1024 * 1024
    )
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.truncated).toBe(true)
  })

  /** Emoji are 4 UTF-8 bytes across 2 surrogate code units — a 2:1 undercount. */
  it('bounds an astral-plane recordset by UTF-8 bytes', async () => {
    const emoji = Array.from({ length: 20 }, () => ({ blob: '😀'.repeat(1024 * 1024) }))
    const result = await executeQuery(makeCapPool(emoji), 'SELECT 1')

    expect(Buffer.byteLength(JSON.stringify(result.rows), 'utf8')).toBeLessThanOrEqual(
      10 * 1024 * 1024
    )
    expect(result.truncated).toBe(true)
  })

  /**
   * Rows sized to divide the ceiling exactly, so an accounting that ignores the
   * array's commas and the fields around it lands precisely on the limit and the
   * body it emits is over by the punctuation and the envelope.
   */
  it('keeps the emitted body inside the ceiling once array and envelope overhead is counted', async () => {
    const rowPayload = 'x'.repeat(2048 - '{"blob":""}'.length)
    const packed = Array.from({ length: 6000 }, () => ({ blob: rowPayload }))
    const result = await executeQuery(makeCapPool(packed), 'SELECT 1')

    const body = toRowsResponseBody(result, 'Query executed successfully. rows returned.')

    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThanOrEqual(10 * 1024 * 1024)
  })
})

describe('toRowsResponseBody truncation disclosure', () => {
  it('discloses a truncated result in both the message and machine-readable fields', () => {
    const body = toRowsResponseBody(
      {
        rows: [{ id: 1 }],
        rowCount: 1,
        truncated: true,
        truncationReason: 'Result truncated to 1 row(s): page with OFFSET ... FETCH NEXT.',
      },
      'Query executed successfully. 1 row(s) returned.'
    )

    expect(body.truncated).toBe(true)
    expect(body.truncationReason).toMatch(/OFFSET/)
    expect(body.message).toBe(
      'Query executed successfully. 1 row(s) returned. Result truncated to 1 row(s): page with OFFSET ... FETCH NEXT.'
    )
  })

  it('leaves a complete result free of truncation fields', () => {
    const body = toRowsResponseBody(
      { rows: [{ id: 1 }], rowCount: 1 },
      'Query executed successfully. 1 row(s) returned.'
    )

    expect(body.message).toBe('Query executed successfully. 1 row(s) returned.')
    expect(body).not.toHaveProperty('truncated')
    expect(body).not.toHaveProperty('truncationReason')
  })
})

describe('executeIntrospect issues a fixed number of queries', () => {
  const schemas = [{ SCHEMA_NAME: 'dbo' }]
  const introspectTables = Array.from({ length: 50 }, (_, i) => ({
    TABLE_NAME: `t${i}`,
    TABLE_SCHEMA: 'dbo',
  }))
  const introspectColumns = introspectTables.flatMap((t) => [
    {
      TABLE_NAME: t.TABLE_NAME,
      COLUMN_NAME: 'id',
      DATA_TYPE: 'int',
      IS_NULLABLE: 'NO',
      COLUMN_DEFAULT: null,
    },
    {
      TABLE_NAME: t.TABLE_NAME,
      COLUMN_NAME: 'owner_id',
      DATA_TYPE: 'int',
      IS_NULLABLE: 'YES',
      COLUMN_DEFAULT: null,
    },
  ])
  const introspectPks = introspectTables.map((t) => ({
    TABLE_NAME: t.TABLE_NAME,
    COLUMN_NAME: 'id',
  }))
  const introspectFks = introspectTables.map((t) => ({
    TABLE_NAME: t.TABLE_NAME,
    COLUMN_NAME: 'owner_id',
    REFERENCED_TABLE_SCHEMA: 'dbo',
    REFERENCED_TABLE_NAME: 'owners',
    REFERENCED_COLUMN_NAME: 'id',
  }))
  const introspectIndexes = introspectTables.map((t) => ({
    TABLE_NAME: t.TABLE_NAME,
    INDEX_NAME: `ix_${t.TABLE_NAME}_owner`,
    COLUMN_NAME: 'owner_id',
    IS_UNIQUE: 0,
  }))

  function makeIntrospectPool() {
    const query = vi.fn(async (text: string) => {
      if (text.includes('FROM sys.schemas s')) return { recordset: schemas }
      if (text.includes('INFORMATION_SCHEMA.TABLES')) return { recordset: introspectTables }
      if (text.includes('INFORMATION_SCHEMA.COLUMNS')) return { recordset: introspectColumns }
      if (text.includes('PRIMARY KEY')) return { recordset: introspectPks }
      if (text.includes('sys.foreign_keys')) return { recordset: introspectFks }
      if (text.includes('sys.index_columns')) return { recordset: introspectIndexes }
      throw new Error(`unexpected query: ${text}`)
    })
    return { pool: { request: () => ({ input: vi.fn().mockReturnThis(), query }) } as never, query }
  }

  it('does not scale its round trips with the table count', async () => {
    // Previously 4 queries per table plus 2: 50 tables meant 202 sequential
    // round trips, each under its own request timeout.
    const { pool, query } = makeIntrospectPool()

    const result = await executeIntrospect(pool, 'dbo')

    expect(result.tables).toHaveLength(50)
    expect(query.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('still attributes columns, keys, and indexes to the right table', async () => {
    const { pool } = makeIntrospectPool()

    const result = await executeIntrospect(pool, 'dbo')
    const table = result.tables.find((t) => t.name === 't7')!

    expect(table.schema).toBe('dbo')
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'owner_id'])
    expect(table.primaryKey).toEqual(['id'])
    expect(table.columns[0].isPrimaryKey).toBe(true)
    expect(table.columns[1].isForeignKey).toBe(true)
    expect(table.columns[1].references).toEqual({ schema: 'dbo', table: 'owners', column: 'id' })
    expect(table.indexes).toEqual([{ name: 'ix_t7_owner', columns: ['owner_id'], unique: false }])
  })
})
