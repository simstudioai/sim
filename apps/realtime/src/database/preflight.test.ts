import { databaseMock, dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { loggerMock } from '@sim/testing/mocks/logger.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { utilsHelpersMock } from '@sim/testing/mocks/utils-helpers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

import { sleep } from '@sim/utils/helpers'
import { assertSchemaCompatibility } from '@/database/preflight'

const mockLimit = dbChainMockFns.limit

/** Builds a Postgres-shaped error carrying a SQLSTATE `code`, as postgres.js throws. */
function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`pg error ${code}`), { code })
}

/** Mirrors how drizzle wraps the driver error: the SQLSTATE lives on `cause`, not the outer error. */
function _wrappedPgError(code: string): Error {
  return new Error('Failed query', { cause: pgError(code) })
}

describe('assertSchemaCompatibility', () => {
  it('throws immediately on an undefined-column mismatch without retrying', async () => {
    mockLimit.mockRejectedValue(pgError('42703'))

    await expect(assertSchemaCompatibility()).rejects.toThrow(/incompatible with the live database/)

    expect(mockLimit).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries transient connection errors and resolves once reachable', async () => {
    mockLimit
      .mockRejectedValueOnce(pgError('ECONNREFUSED'))
      .mockRejectedValueOnce(pgError('ECONNREFUSED'))
      .mockResolvedValueOnce([])

    await expect(assertSchemaCompatibility()).resolves.toBeUndefined()

    expect(mockLimit).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting retries when the database stays unreachable', async () => {
    mockLimit.mockRejectedValue(pgError('ECONNREFUSED'))

    await expect(assertSchemaCompatibility()).rejects.toThrow(/database unreachable/)

    expect(mockLimit).toHaveBeenCalledTimes(5)
    expect(sleep).toHaveBeenCalledTimes(4)
  })
})
