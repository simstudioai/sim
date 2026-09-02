/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAvailable } = vi.hoisted(() => ({ mockAvailable: vi.fn() }))

vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: mockAvailable,
}))

import { resolveKnowledgeSearchDefaults } from '@/lib/knowledge/search/defaults'

describe('resolveKnowledgeSearchDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('keeps an explicit mode either way', async () => {
    mockAvailable.mockResolvedValue(true)
    await expect(
      resolveKnowledgeSearchDefaults({
        workspaceId: 'ws-1',
        userId: 'u-1',
        requestedMode: 'vector',
      })
    ).resolves.toEqual({ searchMode: 'vector', boostRecency: true })
    mockAvailable.mockResolvedValue(false)
    await expect(
      resolveKnowledgeSearchDefaults({
        workspaceId: 'ws-1',
        userId: 'u-1',
        requestedMode: 'hybrid',
      })
    ).resolves.toEqual({ searchMode: 'hybrid', boostRecency: false })
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
