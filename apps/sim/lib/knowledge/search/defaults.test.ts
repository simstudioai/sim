import { describe, expect, it, vi } from 'vitest'

const { mockAvailable } = vi.hoisted(() => ({ mockAvailable: vi.fn() }))

vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: mockAvailable,
}))

import { resolveKnowledgeSearchDefaults } from '@/lib/knowledge/search/defaults'

describe('resolveKnowledgeSearchDefaults', () => {
  it('stays semantic-only with no boost where the feature is off', async () => {
    mockAvailable.mockResolvedValue(false)
    await expect(
      resolveKnowledgeSearchDefaults({
        workspaceId: 'ws-1',
        userId: 'u-1',
        requestedMode: undefined,
      })
    ).resolves.toEqual({ searchMode: 'vector', boostRecency: false })
    expect(mockAvailable).toHaveBeenCalledWith({ workspaceId: 'ws-1', userId: 'u-1' })
  })

  it('defaults to hybrid with the recency boost where the feature is on', async () => {
    mockAvailable.mockResolvedValue(true)
    await expect(
      resolveKnowledgeSearchDefaults({
        workspaceId: 'ws-1',
        userId: undefined,
        requestedMode: undefined,
      })
    ).resolves.toEqual({ searchMode: 'hybrid', boostRecency: true })
    expect(mockAvailable).toHaveBeenCalledWith({ workspaceId: 'ws-1', userId: undefined })
  })

  it('never consults the flag without a workspace, and reads as off', async () => {
    await expect(
      resolveKnowledgeSearchDefaults({
        workspaceId: undefined,
        userId: 'u-1',
        requestedMode: undefined,
      })
    ).resolves.toEqual({ searchMode: 'vector', boostRecency: false })
    expect(mockAvailable).not.toHaveBeenCalled()
  })
})
