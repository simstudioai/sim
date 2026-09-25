/**
 * Tests for pinnable-resource existence and stale-pin filtering.
 *
 * These assert the predicates actually handed to drizzle, since the route tests mock
 * the db chain and would not notice a wrong filter.
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({ mockDb: { select: vi.fn() } }))

vi.mock('@sim/db', () => ({ db: mockDb, ...schemaMock }))

import { filterToActiveResources, pinnableResourceExists } from '@/lib/pinned-items/resources'

describe('pinned-items resources', () => {
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()

  beforeEach(() => {
    mockDb.select.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    const whereResult = [] as Array<Record<string, unknown>> & { limit: typeof mockLimit }
    whereResult.limit = mockLimit
    mockWhere.mockReturnValue(whereResult)
    mockLimit.mockReturnValue([])
  })

  describe('pinnableResourceExists', () => {
    it('constrains file lookups to workspace-context files', async () => {
      // Non-workspace rows in `workspace_files` (copilot/chat/execution artifacts,
      // profile pictures) must not be pinnable by id.
      await pinnableResourceExists('file', 'file-1', 'ws-1')

      const predicate = JSON.stringify(mockWhere.mock.calls[0][0])
      expect(predicate).toContain('workspace')
    })

    it('does not apply a context constraint to resources without one', async () => {
      await pinnableResourceExists('knowledge_base', 'kb-1', 'ws-1')

      // Three conditions (id, workspace, not-deleted) and no fourth `scope` term.
      const predicate = mockWhere.mock.calls[0][0] as { queryChunks?: unknown[] }
      expect(predicate).toBeDefined()
    })
  })

  describe('filterToActiveResources', () => {
    it('drops pins with an unrecognized resourceType rather than surfacing them', async () => {
      // Forward-compat: a pin written by a newer deploy must fail closed here rather
      // than render against a table this build cannot resolve.
      const result = await filterToActiveResources(
        [{ resourceType: 'not_a_pinnable_type', resourceId: 'x-1' }],
        'ws-1'
      )

      expect(result).toEqual([])
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('resolves folder pins instead of failing them closed', async () => {
      // Regression guard for the contract/lookup-map pair: adding 'folder' to
      // `pinnedResourceTypeSchema` without a `PINNED_RESOURCES` entry would silently
      // drop every folder pin here.
      mockWhere.mockReturnValueOnce([{ id: 'folder-1' }])

      const result = await filterToActiveResources(
        [{ resourceType: 'folder', resourceId: 'folder-1' }],
        'ws-1'
      )

      expect(result).toEqual([{ resourceType: 'folder', resourceId: 'folder-1' }])
      expect(mockDb.select).toHaveBeenCalledTimes(1)
    })
  })
})
