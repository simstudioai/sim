import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLimit } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        limit: mockLimit,
      }),
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {},
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@sim/utils/helpers', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

import { sleep } from '@sim/utils/helpers'
import { assertSchemaCompatibility } from '@/database/preflight'

/** Builds a Postgres-shaped error carrying a SQLSTATE `code`, as postgres.js throws. */
function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`pg error ${code}`), { code })
}

/** Mirrors how drizzle wraps the driver error: the SQLSTATE lives on `cause`, not the outer error. */
function wrappedPgError(code: string): Error {
  return new Error('Failed query', { cause: pgError(code) })
}

describe('assertSchemaCompatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves when the representative schema query succeeds', async () => {
    mockLimit.mockResolvedValueOnce([])

    await expect(assertSchemaCompatibility()).resolves.toBeUndefined()

    expect(mockLimit).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on an undefined-column mismatch without retrying', async () => {
    mockLimit.mockRejectedValue(pgError('42703'))

    await expect(assertSchemaCompatibility()).rejects.toThrow(/incompatible with the live database/)

    expect(mockLimit).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('throws immediately on an undefined-table mismatch', async () => {
    mockLimit.mockRejectedValue(pgError('42P01'))

    await expect(assertSchemaCompatibility()).rejects.toThrow(/incompatible with the live database/)

    expect(mockLimit).toHaveBeenCalledTimes(1)
  })

  it('detects a schema mismatch wrapped in error.cause and fails fast', async () => {
    mockLimit.mockRejectedValue(wrappedPgError('42703'))

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
