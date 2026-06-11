import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    error: mockError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

import {
  instrumentPoolClient,
  isInsideDbTransaction,
  runOutsideTransactionContext,
} from './tx-tripwire'

interface FakeReserved {
  unsafe: (query: string) => Promise<unknown[]>
}

function createFakeClient() {
  const rootQueries: string[] = []
  const reservedQueries: string[] = []

  const client = instrumentPoolClient(
    {
      unsafe(query: string) {
        rootQueries.push(query)
        return Promise.resolve([])
      },
      // Mirrors postgres-js: begin issues its internal BEGIN through the root
      // client's unsafe (the instrumented one) before running the callback on
      // a reserved connection.
      begin(...args: unknown[]) {
        const callback = args[args.length - 1] as (reserved: FakeReserved) => unknown
        const reserved: FakeReserved = {
          unsafe: (query: string) => {
            reservedQueries.push(query)
            return Promise.resolve([])
          },
        }
        return Promise.resolve(this.unsafe('begin')).then(() => callback(reserved))
      },
    },
    'test-pool'
  )

  return { client, rootQueries, reservedQueries }
}

afterEach(() => {
  vi.unstubAllEnvs()
  mockError.mockClear()
})

describe('tx tripwire', () => {
  it('marks the transaction context for the duration of a begin callback', async () => {
    const { client } = createFakeClient()

    expect(isInsideDbTransaction()).toBe(false)
    await client.begin(async () => {
      expect(isInsideDbTransaction()).toBe(true)
      await Promise.resolve()
      expect(isInsideDbTransaction()).toBe(true)
    })
    expect(isInsideDbTransaction()).toBe(false)
  })

  it('throws when the root client is queried inside a transaction callback, at any await depth', async () => {
    const { client } = createFakeClient()
    const deeplyNestedHelper = async () => {
      await Promise.resolve()
      return client.unsafe('select 1 as nested_checkout')
    }

    await expect(
      client.begin(async () => {
        await deeplyNestedHelper()
      })
    ).rejects.toThrow(/inside a transaction callback/)
  })

  it('allows queries on the reserved connection inside the callback', async () => {
    const { client, reservedQueries } = createFakeClient()

    await client.begin(async (reserved: FakeReserved) => {
      await reserved.unsafe('select 1 as tx_handle_query')
    })

    expect(reservedQueries).toEqual(['select 1 as tx_handle_query'])
  })

  it('allows root-client queries outside any transaction', async () => {
    const { client, rootQueries } = createFakeClient()

    await client.unsafe('select 1 as plain_query')

    expect(rootQueries).toEqual(['select 1 as plain_query'])
  })

  it('throws when a nested transaction is opened on the root client', async () => {
    const { client } = createFakeClient()

    await expect(
      client.begin(async () => {
        await client.begin(async () => {})
      })
    ).rejects.toThrow(/nested transaction/i)
  })

  it('runOutsideTransactionContext escapes lazy thenables awaited by the caller', async () => {
    const { client, rootQueries } = createFakeClient()

    await client.begin(async () => {
      // Mirrors a drizzle query builder: no work until .then is invoked. The
      // helper must assimilate it inside the exited context so the caller's
      // await (inside the tx context) does not trip the wire.
      const lazyQuery = {
        then<T>(resolve: (value: T) => void) {
          resolve(client.unsafe('select 1 as lazy_escaped') as T)
        },
      }
      await runOutsideTransactionContext(() => lazyQuery)
    })

    expect(rootQueries).toEqual(['begin', 'select 1 as lazy_escaped'])
  })

  it('runOutsideTransactionContext escapes the context, including scheduled promises', async () => {
    const { client, rootQueries } = createFakeClient()

    await client.begin(async () => {
      await runOutsideTransactionContext(() => {
        expect(isInsideDbTransaction()).toBe(false)
        return Promise.resolve().then(() => client.unsafe('select 1 as escaped_query'))
      })
      expect(isInsideDbTransaction()).toBe(true)
    })

    expect(rootQueries).toEqual(['begin', 'select 1 as escaped_query'])
  })

  it('DB_TX_TRIPWIRE=off disables detection', async () => {
    vi.stubEnv('DB_TX_TRIPWIRE', 'off')
    const { client, rootQueries } = createFakeClient()

    await client.begin(async () => {
      await client.unsafe('select 1 as off_mode_query')
    })

    expect(rootQueries).toEqual(['begin', 'select 1 as off_mode_query'])
    expect(mockError).not.toHaveBeenCalled()
  })

  it('DB_TX_TRIPWIRE=warn logs instead of throwing and dedupes repeats', async () => {
    vi.stubEnv('DB_TX_TRIPWIRE', 'warn')
    const { client, rootQueries } = createFakeClient()

    await client.begin(async () => {
      await client.unsafe('select 1 as warn_mode_query')
      await client.unsafe('select 1 as warn_mode_query')
    })

    expect(rootQueries).toEqual([
      'begin',
      'select 1 as warn_mode_query',
      'select 1 as warn_mode_query',
    ])
    expect(mockError).toHaveBeenCalledTimes(1)
    expect(mockError.mock.calls[0][1]).toMatchObject({ poolName: 'test-pool' })
  })

  it('DB_TX_TRIPWIRE=warn reports a nested transaction exactly once', async () => {
    vi.stubEnv('DB_TX_TRIPWIRE', 'warn')
    const { client } = createFakeClient()

    await client.begin(async () => {
      await client.begin(async () => {})
    })

    expect(mockError).toHaveBeenCalledTimes(1)
  })
})
