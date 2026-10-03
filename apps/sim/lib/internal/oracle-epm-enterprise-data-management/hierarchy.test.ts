/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { browseEdmHierarchy } from '@/lib/internal/oracle-epm-enterprise-data-management/hierarchy'
import { edmNodeSchema } from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const shared = '33333333-3333-4333-8333-333333333333'
const bounds = { maxDepth: 2, maxNodes: 200, pageSize: 50, maxRequests: 50 }
const node = (id: string, extra = {}) =>
  edmNodeSchema.parse({ id, name: id, hasChildren: false, ...extra })

describe('EDM bounded hierarchy workflows', () => {
  it('preserves shared-node occurrences under different parents and locations', async () => {
    const result = await browseEdmHierarchy(bounds, async (frontier) => ({
      items:
        frontier.parentNodeId === null
          ? [node(a, { hasChildren: true }), node(b, { hasChildren: true })]
          : [
              node(shared, {
                parentNodeId: frontier.parentNodeId,
                location: `${frontier.parentNodeId},${shared}`,
              }),
            ],
      hasMore: false,
    }))
    expect(
      result.nodes.filter((item) => item.id === shared).map((item) => item.traversalPath)
    ).toEqual([
      [a, shared],
      [b, shared],
    ])
    expect(result.nodes.filter((item) => item.id === shared).map((item) => item.location)).toEqual([
      `${a},${shared}`,
      `${b},${shared}`,
    ])
    expect(result).toMatchObject({
      count: 4,
      providerRequests: 3,
      truncated: false,
      remainingFrontier: [],
    })
  })
  it('reports depth-limited frontier without making an extra provider request', async () => {
    const read = vi.fn(async () => ({ items: [node(a, { hasChildren: true })], hasMore: false }))
    const result = await browseEdmHierarchy({ ...bounds, maxDepth: 0 }, read)
    expect(read).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      truncated: true,
      truncationReasons: ['depth'],
      remainingFrontier: [{ parentNodeId: a, depth: 1, offset: 0 }],
    })
  })
  it('bounds pages by remaining node capacity and reports the next page', async () => {
    const read = vi.fn(async () => ({ items: [node(a), node(b)], hasMore: true }))
    const result = await browseEdmHierarchy({ ...bounds, maxNodes: 2 }, read)
    expect(read).toHaveBeenCalledWith(expect.anything(), 2)
    expect(result).toMatchObject({
      count: 2,
      truncated: true,
      truncationReasons: ['nodes'],
      remainingFrontier: [{ offset: 2 }],
    })
  })
  it('stops at the provider-request budget and preserves unvisited parents', async () => {
    const result = await browseEdmHierarchy({ ...bounds, maxRequests: 1 }, async () => ({
      items: [node(a, { hasChildren: true })],
      hasMore: false,
    }))
    expect(result).toMatchObject({
      providerRequests: 1,
      truncated: true,
      truncationReasons: ['provider-requests'],
      remainingFrontier: [{ parentNodeId: a }],
    })
  })
  it('detects a provider repeating a page instead of looping or duplicating nodes', async () => {
    const read = vi.fn(async () => ({ items: [node(a)], hasMore: true }))
    const result = await browseEdmHierarchy(bounds, read)
    expect(read).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      count: 1,
      truncated: true,
      truncationReasons: ['repeated-page'],
    })
  })
  it('retains an encountered cycle as a distinct occurrence but does not expand it', async () => {
    const result = await browseEdmHierarchy(bounds, async () => ({
      items: [node(a, { hasChildren: true })],
      hasMore: false,
    }))
    expect(result).toMatchObject({
      count: 2,
      providerRequests: 2,
      truncated: true,
      truncationReasons: ['cycle'],
    })
  })
  it('does not start provider work after cancellation', async () => {
    const read = vi.fn()
    await expect(browseEdmHierarchy(bounds, read, AbortSignal.abort())).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
  it('bounds accumulated output bytes across otherwise valid provider pages', async () => {
    const result = await browseEdmHierarchy(
      { ...bounds, maxNodes: 500 },
      async (frontier, limit) => ({
        items: Array.from({ length: limit }, (_, index) =>
          node(
            `${(frontier.offset + index).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
            {
              name: 'x'.repeat(20_000),
              description: 'y'.repeat(20_000),
            }
          )
        ),
        hasMore: true,
      })
    )
    expect(result.count).toBeGreaterThan(50)
    expect(result.count).toBeLessThan(500)
    expect(Buffer.byteLength(JSON.stringify(result.nodes))).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(result).toMatchObject({
      truncated: true,
      truncationReasons: ['output-bytes'],
      remainingFrontier: [{ offset: result.count }],
    })
  })
})
