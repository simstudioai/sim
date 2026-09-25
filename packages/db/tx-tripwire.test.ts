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
})
