/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  compileFileSearchPattern,
  FileSearchPatternError,
} from '@/lib/workspace-files/search/pattern'
import { searchWorkspaceFileIndex } from '@/lib/workspace-files/search/repository'

/**
 * The shape a failed query really arrives in, captured from PostgreSQL 17
 * through drizzle 0.45: the driver's SQLSTATE sits on `cause`, not on the
 * `DrizzleQueryError` that reaches the caller.
 */
function driverError(code: string): Error {
  const driver = Object.assign(new Error('driver detail with query text'), { code })
  return new Error('Failed query', { cause: driver })
}

describe('searchWorkspaceFileIndex fault mapping', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it.each([
    ['57014', /Search timed out/],
    ['2201B', /Invalid search pattern/],
  ])('turns SQLSTATE %s into a fault the caller can act on', async (code, message) => {
    dbChainMockFns.transaction.mockRejectedValueOnce(driverError(code))

    const search = searchWorkspaceFileIndex({
      workspaceId: 'workspace-1',
      pattern: compileFileSearchPattern('error \\d+', 'regex'),
      maxResults: 50,
    })

    await expect(search).rejects.toBeInstanceOf(FileSearchPatternError)
    await expect(search).rejects.toThrow(message)
  })

  it('does not reinterpret an unrelated database fault', async () => {
    dbChainMockFns.transaction.mockRejectedValueOnce(driverError('23505'))

    await expect(
      searchWorkspaceFileIndex({
        workspaceId: 'workspace-1',
        pattern: compileFileSearchPattern('error \\d+', 'regex'),
        maxResults: 50,
      })
    ).rejects.not.toBeInstanceOf(FileSearchPatternError)
  })

  it('caps how long a search may hold its connection', async () => {
    await searchWorkspaceFileIndex({
      workspaceId: 'workspace-1',
      pattern: compileFileSearchPattern('needle', 'exact'),
      maxResults: 50,
    })

    const guards = JSON.stringify(dbChainMockFns.execute.mock.calls[0]?.[0])
    expect(guards).toContain('statement_timeout')
    expect(guards).toContain('lock_timeout')
    expect(db.transaction).toHaveBeenCalled()
  })
})
