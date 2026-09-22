/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { USAGE_LEDGER_STATEMENT_TIMEOUT_MS } from '@/lib/billing/constants'
import { readLedgerBounded } from '@/lib/billing/core/ledger-read'
import type { DbClient } from '@/lib/db/types'

const renderedSql = (statement: unknown) =>
  (statement as { toSQL: () => { sql: string } }).toSQL().sql

describe('readLedgerBounded', () => {
  const execute = vi.fn().mockResolvedValue([])
  const tx = { execute }
  const transaction = vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  const executor = { transaction } as unknown as DbClient

  beforeEach(() => vi.clearAllMocks())

  it('bounds the statement inside one transaction on the given client, before the read', async () => {
    const read = vi.fn().mockResolvedValue([{ cost: '12.5' }])
    await expect(readLedgerBounded(executor, read)).resolves.toEqual([{ cost: '12.5' }])
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls.map(([statement]) => renderedSql(statement))).toEqual([
      `SET LOCAL statement_timeout = '${USAGE_LEDGER_STATEMENT_TIMEOUT_MS}ms'`,
    ])
    expect(read).toHaveBeenCalledWith(tx)
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0])
  })

  it('surfaces the read failure to the caller', async () => {
    const failure = new Error('canceling statement due to statement timeout')
    await expect(readLedgerBounded(executor, () => Promise.reject(failure))).rejects.toBe(failure)
  })
})
