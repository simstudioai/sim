import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

import { resolveKnowledgeSearchDefaults } from '@/lib/knowledge/search/defaults'

const mockAvailable = knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable

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
