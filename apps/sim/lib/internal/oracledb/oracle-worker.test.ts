/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { compileFunction } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface WorkerTestApi {
  assertSupportedColumns: (
    metadata: Array<Record<string, unknown>>,
    driver: Record<string, unknown>
  ) => void
  buildConnectString: (connection: Record<string, unknown>) => string
  buildConnectionOptions: (connection: Record<string, unknown>) => Record<string, unknown>
  consumeResultSet: (
    result: Record<string, unknown>,
    statement: Record<string, unknown>,
    budget: { remaining: () => number; admit: (bytes: number) => boolean },
    driver: Record<string, unknown>
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number; truncated?: boolean }>
  createBudget: () => { remaining: () => number; admit: (bytes: number) => boolean }
  createFetchTypeHandler: (
    driver: Record<string, unknown>
  ) => (metadata: Record<string, unknown>) => { type: unknown } | undefined
  executeStatement: (
    connection: { execute: (...args: unknown[]) => Promise<Record<string, unknown>> },
    statement: Record<string, unknown>,
    budget: { remaining: () => number; admit: (bytes: number) => boolean },
    driver: Record<string, unknown>
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
  uniqueColumnNames: (metadata: Array<{ name?: string }>) => string[]
  normalizeColumnValue: (
    value: unknown,
    remainingBytes: number,
    driver: Record<string, unknown>
  ) => Promise<unknown>
  normalizeJsonValue: (value: unknown, state: { items: number; seen: WeakSet<object> }) => unknown
  setCancelled: (value: boolean) => void
  validateRequest: (request: unknown) => unknown
}

interface WorkerPrivateTestApi {
  cancelCurrentOperation: () => Promise<void>
  run: (request: ReturnType<typeof request>) => Promise<Array<{ rowCount: number }>>
  safeMessage: (error: unknown, connection?: Record<string, unknown>) => string
  setResources: (
    connection?: { break: () => Promise<void>; close: () => Promise<void> },
    resultSet?: { close: () => Promise<void> }
  ) => void
}

const requireForTest = createRequire(__filename)
const worker = requireForTest('./oracle-worker.cjs') as { _test: WorkerTestApi }

function loadPrivateWorkerTestApi(oracledb: Record<string, unknown> = {}): WorkerPrivateTestApi {
  const workerPath = requireForTest.resolve('./oracle-worker.cjs')
  const workerRequire = createRequire(workerPath)
  const moduleForTest: { exports: Record<string, unknown> } = { exports: {} }
  const verifyOracleDbPatch = vi.fn()
  const injectedRequire = ((id: string) => {
    if (id === '../../../scripts/verify-oracledb-patch.cjs') return { verifyOracleDbPatch }
    if (id === 'oracledb') return oracledb
    return workerRequire(id)
  }) as NodeJS.Require
  const sigtermListeners = new Set(process.listeners('SIGTERM'))
  const evaluate = compileFunction(
    `${readFileSync(workerPath, 'utf8')}\nmodule.exports.__privateTest = {
      cancelCurrentOperation,
      run,
      safeMessage,
      setResources(connection, resultSet) {
        currentConnection = connection
        currentResultSet = resultSet
        cancelled = false
      },
    }`,
    ['require', 'module', 'exports', '__filename', '__dirname'],
    { filename: workerPath }
  )

  try {
    evaluate(injectedRequire, moduleForTest, moduleForTest.exports, workerPath, '')
  } finally {
    for (const listener of process.listeners('SIGTERM')) {
      if (!sigtermListeners.has(listener)) process.removeListener('SIGTERM', listener)
    }
  }

  return (moduleForTest.exports as { __privateTest: WorkerPrivateTestApi }).__privateTest
}

const CONNECTION = {
  host: 'db.example.com',
  port: 1521,
  protocol: 'tcp',
  connectionType: 'serviceName',
  serviceName: 'FREEPDB1',
  username: 'application',
  password: 'secret',
  connectionTimeout: 15000,
  proxyHost: '127.0.0.1',
  proxyPort: 32000,
} as const

class FakeLob extends Readable {
  type: symbol
  private readonly content: Buffer

  constructor(type: symbol, content: string | Buffer) {
    super()
    this.type = type
    this.content = Buffer.isBuffer(content) ? content : Buffer.from(content)
  }

  _read(): void {
    this.push(this.content)
    this.push(null)
  }
}

class FailingLob extends FakeLob {
  constructor(type: symbol) {
    super(type, '')
  }

  _read(): void {
    this.destroy(new Error('LOB stream failed'))
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    type: 'execute',
    connection: CONNECTION,
    statements: [{ sql: 'SELECT :id FROM DUAL', binds: { id: 1 }, maxRows: 10000 }],
    readOnlyTransaction: true,
    ...overrides,
  }
}

describe('Oracle Database worker hardening', () => {
  afterEach(() => worker._test.setCancelled(false))

  it('builds service-name and SID descriptors without accepting raw descriptors', () => {
    expect(worker._test.buildConnectString(CONNECTION)).toBe(
      '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))'
    )
    expect(
      worker._test.buildConnectString({
        ...CONNECTION,
        protocol: 'tcps',
        connectionType: 'sid',
        serviceName: undefined,
        sid: 'ORCL',
      })
    ).toContain('(PROTOCOL=TCPS)')
    expect(worker._test.buildConnectString({ ...CONNECTION, host: '[2001:db8::10]' })).toContain(
      '(HOST=2001:db8::10)'
    )
  })

  it('pins TCP and TCPS through loopback while keeping wallet material in memory', () => {
    expect(worker._test.buildConnectionOptions(CONNECTION)).toMatchObject({
      httpsProxy: '127.0.0.1',
      httpsProxyPort: 32000,
      connectTimeout: 15,
      transportConnectTimeout: 15,
      retryCount: 0,
      sslServerDNMatch: true,
    })

    const wallet = '-----BEGIN CERTIFICATE-----\nwallet\n-----END CERTIFICATE-----'
    expect(
      worker._test.buildConnectionOptions({
        ...CONNECTION,
        protocol: 'tcps',
        walletContent: wallet,
        walletPassword: 'wallet-secret',
      })
    ).toMatchObject({
      connectString: expect.stringContaining('(PROTOCOL=TCPS)'),
      httpsProxy: '127.0.0.1',
      httpsProxyPort: 32000,
      sslServerDNMatch: true,
      walletContent: wallet,
      walletPassword: 'wallet-secret',
    })
  })

  it('converts numeric metadata using dbType while leaving native JSON fail-closed', () => {
    const NUMBER = Symbol('NUMBER')
    const JSON_TYPE = Symbol('JSON')
    const VARCHAR = Symbol('VARCHAR')
    const handler = worker._test.createFetchTypeHandler({
      DB_TYPE_NUMBER: NUMBER,
      DB_TYPE_JSON: JSON_TYPE,
      DB_TYPE_VARCHAR: VARCHAR,
    })

    expect(handler({ dbType: NUMBER })).toEqual({ type: VARCHAR })
    expect(handler({ dbType: JSON_TYPE })).toBeUndefined()
    expect(handler({ type: NUMBER })).toBeUndefined()
  })

  it('disables row prefetch and materializes one row per bounded fetch', async () => {
    const resultSet = {
      close: vi.fn().mockResolvedValue(undefined),
      getRows: vi.fn().mockResolvedValue([]),
    }
    const connection = {
      execute: vi.fn().mockResolvedValue({ resultSet, metaData: [] }),
    }

    await expect(
      worker._test.executeStatement(
        connection,
        { sql: 'SELECT 1 FROM DUAL', maxRows: 10 },
        worker._test.createBudget(),
        { OUT_FORMAT_ARRAY: 1 }
      )
    ).resolves.toEqual({ rows: [], rowCount: 0 })

    expect(connection.execute).toHaveBeenCalledWith(
      'SELECT 1 FROM DUAL',
      {},
      expect.objectContaining({ resultSet: true, fetchArraySize: 1, prefetchRows: 0 })
    )
    expect(resultSet.getRows).toHaveBeenCalledWith(1)
  })

  it('preserves duplicate result columns with deterministic names', () => {
    expect(
      worker._test.uniqueColumnNames([
        { name: 'ID' },
        { name: 'ID' },
        { name: 'ID_2' },
        { name: 'ID' },
      ])
    ).toEqual(['ID', 'ID_2', 'ID_2_2', 'ID_3'])
  })

  it('rejects nested cursor columns so every result set can be closed', () => {
    const CURSOR = Symbol('CURSOR')
    expect(() =>
      worker._test.assertSupportedColumns([{ dbType: CURSOR }], { DB_TYPE_CURSOR: CURSOR })
    ).toThrow('cursor-expression columns')
    expect(() =>
      worker._test.assertSupportedColumns([{ dbType: Symbol('VARCHAR') }], {
        DB_TYPE_CURSOR: CURSOR,
      })
    ).not.toThrow()
  })

  it('rejects object columns whose nested LOBs cannot be closed safely', () => {
    const OBJECT = Symbol('OBJECT')
    expect(() =>
      worker._test.assertSupportedColumns([{ dbType: OBJECT }], { DB_TYPE_OBJECT: OBJECT })
    ).toThrow('object and collection columns')
  })

  it('normalizes dates, binary values, and __proto__ JSON keys safely', () => {
    const source = JSON.parse(
      '{"created":"2026-01-01T00:00:00.000Z","__proto__":{"polluted":true}}'
    ) as Record<string, unknown>
    source.created = new Date('2026-01-01T00:00:00.000Z')
    source.binary = Buffer.from([0, 255])
    const normalized = worker._test.normalizeJsonValue(source, {
      items: 0,
      seen: new WeakSet(),
    }) as Record<string, unknown>

    expect(Object.getPrototypeOf(normalized)).toBeNull()
    expect(normalized).toMatchObject({
      created: '2026-01-01T00:00:00.000Z',
      binary: { type: 'base64', data: 'AP8=' },
    })
    expect(Object.hasOwn(normalized, '__proto__')).toBe(true)
    expect(normalized.__proto__).toEqual({ polluted: true })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('streams BLOB values as tagged base64 and destroys their LOBs', async () => {
    const BLOB = Symbol('BLOB')
    const driver = { Lob: FakeLob, DB_TYPE_BLOB: BLOB }
    const blob = new FakeLob(BLOB, Buffer.from([1, 2, 3]))

    await expect(worker._test.normalizeColumnValue(blob, 1024, driver)).resolves.toEqual({
      type: 'base64',
      data: 'AQID',
    })
    expect(blob.destroyed).toBe(true)
  })

  it('rejects BFILE metadata because Thin streaming does not open BFILE locators', () => {
    const BFILE = Symbol('BFILE')
    expect(() =>
      worker._test.assertSupportedColumns([{ dbType: BFILE }], { DB_TYPE_BFILE: BFILE })
    ).toThrow('BFILE columns')
  })

  it('rejects XMLTYPE metadata before the driver can materialize an unbounded value', () => {
    const XMLTYPE = Symbol('XMLTYPE')
    expect(() =>
      worker._test.assertSupportedColumns([{ dbType: XMLTYPE }], { DB_TYPE_XMLTYPE: XMLTYPE })
    ).toThrow('XMLTYPE columns')
  })

  it.each([
    ['LONG', 'DB_TYPE_LONG', 'LONG'],
    ['LONG NVARCHAR', 'DB_TYPE_LONG_NVARCHAR', 'LONG'],
    ['LONG RAW', 'DB_TYPE_LONG_RAW', 'LONG'],
    ['native JSON', 'DB_TYPE_JSON', 'JSON_SERIALIZE'],
    ['VECTOR', 'DB_TYPE_VECTOR', 'VECTOR'],
  ])('rejects %s metadata before fetching the first row', async (_label, typeName, message) => {
    const unsafeType = Symbol(typeName)
    const resultSet = {
      close: vi.fn().mockResolvedValue(undefined),
      getRows: vi.fn(),
    }

    await expect(
      worker._test.consumeResultSet(
        { resultSet, metaData: [{ name: 'VALUE', dbType: unsafeType }] },
        { maxRows: 10 },
        worker._test.createBudget(),
        { [typeName]: unsafeType }
      )
    ).rejects.toThrow(message)
    expect(resultSet.getRows).not.toHaveBeenCalled()
    expect(resultSet.close).toHaveBeenCalledOnce()
  })

  it('normalizes a streamed result and closes its result set on success', async () => {
    const CLOB = Symbol('CLOB')
    const VARCHAR = Symbol('VARCHAR')
    const DATE = Symbol('DATE')
    const RAW = Symbol('RAW')
    const JSON_TYPE = Symbol('JSON')
    const text = new FakeLob(CLOB, 'hello 界')
    const json = JSON.parse('{"__proto__":{"safe":true}}') as Record<string, unknown>
    let fetched = false
    const resultSet = {
      close: vi.fn().mockResolvedValue(undefined),
      getRows: vi.fn().mockImplementation(() => {
        if (fetched) return []
        fetched = true
        return [[text, new Date('2026-01-01T00:00:00.000Z'), Buffer.from([0, 255]), json]]
      }),
    }

    const result = await worker._test.consumeResultSet(
      {
        resultSet,
        metaData: [
          { name: 'TEXT', dbType: VARCHAR },
          { name: 'CREATED_AT', dbType: DATE },
          { name: 'BINARY', dbType: RAW },
          { name: 'DOCUMENT', dbType: JSON_TYPE },
        ],
      },
      { maxRows: 10 },
      worker._test.createBudget(),
      {
        Lob: FakeLob,
        DB_TYPE_CLOB: CLOB,
        DB_TYPE_CURSOR: Symbol('CURSOR'),
        DB_TYPE_OBJECT: Symbol('OBJECT'),
      }
    )

    expect(result).toMatchObject({
      rowCount: 1,
      rows: [
        {
          TEXT: 'hello 界',
          CREATED_AT: '2026-01-01T00:00:00.000Z',
          BINARY: { type: 'base64', data: 'AP8=' },
        },
      ],
    })
    const document = result.rows[0].DOCUMENT as Record<string, unknown>
    expect(Object.hasOwn(document, '__proto__')).toBe(true)
    expect(document.__proto__).toEqual({ safe: true })
    expect(text.destroyed).toBe(true)
    expect(resultSet.close).toHaveBeenCalledOnce()
  })

  it('enforces the exact row limit and destroys prefetched tail LOBs', async () => {
    const CLOB = Symbol('CLOB')
    const returned = new FakeLob(CLOB, 'first')
    const prefetched = new FakeLob(CLOB, 'second')
    const resultSet = {
      close: vi.fn().mockResolvedValue(undefined),
      getRows: vi.fn().mockResolvedValue([[returned], [prefetched]]),
    }

    await expect(
      worker._test.consumeResultSet(
        { resultSet, metaData: [{ name: 'VALUE', dbType: CLOB }] },
        { maxRows: 1 },
        worker._test.createBudget(),
        { Lob: FakeLob, DB_TYPE_CLOB: CLOB }
      )
    ).resolves.toMatchObject({ rows: [{ VALUE: 'first' }], rowCount: 1, truncated: true })
    expect(returned.destroyed).toBe(true)
    expect(prefetched.destroyed).toBe(true)
    expect(resultSet.close).toHaveBeenCalledOnce()
  })

  it('closes the result set and every prefetched LOB when a UTF-8 row exceeds budget', async () => {
    const CLOB = Symbol('CLOB')
    const first = new FakeLob(CLOB, '界'.repeat(100))
    const prefetched = new FakeLob(CLOB, 'later')
    let fetched = false
    const resultSet = {
      close: vi.fn().mockResolvedValue(undefined),
      getRows: vi.fn().mockImplementation(() => {
        if (fetched) return []
        fetched = true
        return [[first], [prefetched]]
      }),
    }
    const tinyBudget = {
      remaining: () => 32,
      admit: () => false,
    }

    await expect(
      worker._test.consumeResultSet(
        { resultSet, metaData: [{ name: 'VALUE', dbType: CLOB }] },
        { maxRows: 10 },
        tinyBudget,
        { Lob: FakeLob, DB_TYPE_CLOB: CLOB }
      )
    ).resolves.toMatchObject({ rows: [], rowCount: 0, truncated: true })
    expect(first.destroyed).toBe(true)
    expect(prefetched.destroyed).toBe(true)
    expect(resultSet.close).toHaveBeenCalledOnce()
  })

  it('destroys the current and prefetched LOBs and closes the result set on error', async () => {
    const CLOB = Symbol('CLOB')
    const failing = new FailingLob(CLOB)
    const prefetched = new FakeLob(CLOB, 'later')
    const resultSet = {
      close: vi.fn().mockResolvedValue(undefined),
      getRows: vi.fn().mockResolvedValue([[failing], [prefetched]]),
    }

    await expect(
      worker._test.consumeResultSet(
        { resultSet, metaData: [{ name: 'VALUE', dbType: CLOB }] },
        { maxRows: 10 },
        worker._test.createBudget(),
        { Lob: FakeLob, DB_TYPE_CLOB: CLOB }
      )
    ).rejects.toThrow('LOB stream failed')
    expect(failing.destroyed).toBe(true)
    expect(prefetched.destroyed).toBe(true)
    expect(resultSet.close).toHaveBeenCalledOnce()
  })

  it('destroys prefetched LOBs and closes the result set when cancellation wins', async () => {
    const CLOB = Symbol('CLOB')
    const current = new FakeLob(CLOB, 'current')
    const prefetched = new FakeLob(CLOB, 'later')
    const resultSet = {
      close: vi.fn().mockResolvedValue(undefined),
      getRows: vi.fn().mockImplementation(() => {
        worker._test.setCancelled(true)
        return [[current], [prefetched]]
      }),
    }

    await expect(
      worker._test.consumeResultSet(
        { resultSet, metaData: [{ name: 'VALUE', dbType: CLOB }] },
        { maxRows: 10 },
        worker._test.createBudget(),
        { Lob: FakeLob, DB_TYPE_CLOB: CLOB }
      )
    ).rejects.toThrow('cancelled')
    expect(current.destroyed).toBe(true)
    expect(prefetched.destroyed).toBe(true)
    expect(resultSet.close).toHaveBeenCalledOnce()
  })

  it('rejects non-loopback proxy injection and non-scalar binds', () => {
    expect(() =>
      worker._test.validateRequest(
        request({ connection: { ...CONNECTION, proxyHost: 'proxy.example.com' } })
      )
    ).toThrow('loopback')
    expect(() =>
      worker._test.validateRequest(
        request({
          statements: [{ sql: 'SELECT :value FROM DUAL', binds: { value: true }, maxRows: 1 }],
        })
      )
    ).toThrow('strings, finite numbers, or null')
  })

  it('rejects a wallet on plaintext TCP', () => {
    expect(() =>
      worker._test.validateRequest(
        request({
          connection: {
            ...CONNECTION,
            walletContent: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
          },
        })
      )
    ).toThrow('wallet requires TCPS')
  })

  it('redacts connection secrets and PEM blocks before bounding worker errors', () => {
    const privateApi = loadPrivateWorkerTestApi()
    const wallet = '-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----'
    const message = privateApi.safeMessage(
      new Error(
        `password=db-secret wallet=${wallet} walletPassword=wallet-secret ${'x'.repeat(3000)}`
      ),
      {
        password: 'db-secret',
        walletContent: wallet,
        walletPassword: 'wallet-secret',
      }
    )

    expect(message).not.toContain('db-secret')
    expect(message).not.toContain('wallet-secret')
    expect(message).not.toContain('private-key-material')
    expect(message).toContain('[REDACTED]')
    expect(message.length).toBe(2000)
  })

  it('breaks the connection and closes the result set and connection on cancellation', async () => {
    const privateApi = loadPrivateWorkerTestApi()
    const connection = {
      break: vi.fn().mockRejectedValue(new Error('break already completed')),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const resultSet = { close: vi.fn().mockResolvedValue(undefined) }
    privateApi.setResources(connection, resultSet)

    await expect(privateApi.cancelCurrentOperation()).resolves.toBeUndefined()

    expect(connection.break).toHaveBeenCalledOnce()
    expect(resultSet.close).toHaveBeenCalledOnce()
    expect(connection.close).toHaveBeenCalledOnce()
  })

  it('rolls back read-only work and closes the connection on success and statement failure', async () => {
    const successConnection = {
      break: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowsAffected: 1 }),
      rollback: vi.fn().mockResolvedValue(undefined),
    }
    const failedConnection = {
      break: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      execute: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('statement failed')),
      rollback: vi.fn().mockResolvedValue(undefined),
    }
    const getConnection = vi
      .fn()
      .mockResolvedValueOnce(successConnection)
      .mockResolvedValueOnce(failedConnection)
    const privateApi = loadPrivateWorkerTestApi({ getConnection })

    await expect(privateApi.run(request())).resolves.toEqual([{ rows: [], rowCount: 1 }])
    expect(successConnection.execute).toHaveBeenNthCalledWith(1, 'SET TRANSACTION READ ONLY')
    expect(successConnection.rollback).toHaveBeenCalledOnce()
    expect(successConnection.close).toHaveBeenCalledOnce()

    await expect(privateApi.run(request())).rejects.toThrow('statement failed')
    expect(failedConnection.rollback).toHaveBeenCalledOnce()
    expect(failedConnection.close).toHaveBeenCalledOnce()
  })
})
