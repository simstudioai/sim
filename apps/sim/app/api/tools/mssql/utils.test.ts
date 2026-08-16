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
  executeQuery,
  type MSSQLConnectionConfig,
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
