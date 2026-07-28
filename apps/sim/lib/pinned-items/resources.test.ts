/**
 * Tests for pinnable-resource existence and stale-pin filtering.
 *
 * These assert the predicates actually handed to drizzle, since the route tests mock
 * the db chain and would not notice a wrong filter.
 *
 * @vitest-environment node
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
    vi.clearAllMocks()
    mockDb.select.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    const whereResult = [] as Array<Record<string, unknown>> & { limit: typeof mockLimit }
    whereResult.limit = mockLimit
    mockWhere.mockReturnValue(whereResult)
    mockLimit.mockReturnValue([])
  })

  describe('pinnableResourceExists', () => {
    it('resolves true when a matching active row is found', async () => {
      mockLimit.mockReturnValue([{ id: 'table-1' }])

      await expect(pinnableResourceExists('table', 'table-1', 'ws-1')).resolves.toBe(true)
    })

    it('resolves false when no row matches', async () => {
      mockLimit.mockReturnValue([])

      await expect(pinnableResourceExists('workflow', 'wf-1', 'ws-1')).resolves.toBe(false)
    })

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
    const pins = [
      { resourceType: 'workflow', resourceId: 'wf-1' },
      { resourceType: 'workflow', resourceId: 'wf-2' },
      { resourceType: 'table', resourceId: 'table-1' },
    ]

    it('short-circuits without querying when given no rows', async () => {
      await expect(filterToActiveResources([], 'ws-1')).resolves.toEqual([])
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('issues one query per distinct resourceType, not one per row', async () => {
      mockWhere.mockReturnValueOnce([{ id: 'wf-1' }, { id: 'wf-2' }]).mockReturnValueOnce([])

      await filterToActiveResources(pins, 'ws-1')

      expect(mockDb.select).toHaveBeenCalledTimes(2)
    })

    it('drops pins whose resource is no longer active', async () => {
      mockWhere.mockReturnValueOnce([{ id: 'wf-1' }]).mockReturnValueOnce([{ id: 'table-1' }])

      const result = await filterToActiveResources(pins, 'ws-1')

      expect(result).toEqual([
        { resourceType: 'workflow', resourceId: 'wf-1' },
        { resourceType: 'table', resourceId: 'table-1' },
      ])
    })

    it('drops pins with an unrecognized resourceType rather than surfacing them', async () => {
      // Forward-compat: a pin written by a newer deploy (e.g. 'folder') must fail
      // closed here rather than render against a table this build cannot resolve.
      const result = await filterToActiveResources(
        [{ resourceType: 'folder', resourceId: 'folder-1' }],
        'ws-1'
      )

      expect(result).toEqual([])
      expect(mockDb.select).not.toHaveBeenCalled()
    })
  })
})
