/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { listPersonalApiKeysContract, listWorkspaceApiKeysContract } from '@/lib/api/contracts'
import { fetchApiKeys } from '@/hooks/queries/api-keys'

describe('API key settings scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads account keys without a workspace request', async () => {
    mockRequestJson.mockResolvedValueOnce({ keys: [{ id: 'personal-key' }] })

    await expect(fetchApiKeys('', 'personal')).resolves.toEqual({
      workspaceKeys: [],
      personalKeys: [{ id: 'personal-key' }],
      conflicts: [],
    })
    expect(mockRequestJson).toHaveBeenCalledOnce()
    expect(mockRequestJson).toHaveBeenCalledWith(listPersonalApiKeysContract, {
      signal: undefined,
    })
  })

  it('loads workspace keys only from the routed workspace', async () => {
    mockRequestJson.mockResolvedValueOnce({ keys: [{ id: 'workspace-key' }] })

    await expect(fetchApiKeys('workspace-route', 'workspace')).resolves.toEqual({
      workspaceKeys: [{ id: 'workspace-key' }],
      personalKeys: [],
      conflicts: [],
    })
    expect(mockRequestJson).toHaveBeenCalledOnce()
    expect(mockRequestJson).toHaveBeenCalledWith(listWorkspaceApiKeysContract, {
      params: { id: 'workspace-route' },
      signal: undefined,
    })
  })
})
