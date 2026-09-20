/**
 * @vitest-environment node
 */
import { backfillProjectionSourceAcl } from '@sim/db/script-migrations/0021_embedding_search_connector'
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'

/** A session that must never be reached: every case below is refused before the first page. */
const untouched = { begin: vi.fn() } as unknown as Sql

describe('backfillProjectionSourceAcl', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a page size of %s instead of reporting the projection filled',
    async (pageSize) => {
      await expect(
        backfillProjectionSourceAcl(untouched, 'embedding_search', { pageSize })
      ).rejects.toThrow('page size must be a positive integer')
      expect(untouched.begin).not.toHaveBeenCalled()
    }
  )

  it.each([-1, Number.NaN])('refuses a pause of %s', async (pauseMs) => {
    await expect(
      backfillProjectionSourceAcl(untouched, 'embedding_search', { pauseMs })
    ).rejects.toThrow('pause must be a non-negative number')
    expect(untouched.begin).not.toHaveBeenCalled()
  })
})
