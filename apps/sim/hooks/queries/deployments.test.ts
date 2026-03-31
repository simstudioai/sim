/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateDeploymentQueries } from '@/hooks/queries/deployments'
import { fetchDeploymentVersionState } from '@/hooks/queries/utils/fetch-deployment-version-state'

describe('deployment query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates the deployment info, state, and versions queries', async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }

    await invalidateDeploymentQueries(queryClient as any, 'wf-1')

    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['deployments', 'info', 'wf-1'],
    })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['deployments', 'deployedState', 'wf-1'],
    })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ['deployments', 'versions', 'wf-1'],
    })
  })

  it('fetches deployment version state through the shared helper', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        deployedState: { blocks: {}, edges: [], loops: {}, parallels: {}, lastSaved: 1 },
      }),
    }) as typeof fetch

    await expect(fetchDeploymentVersionState('wf-1', 3)).resolves.toEqual({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      lastSaved: 1,
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/workflows/wf-1/deployments/3', {
      signal: undefined,
    })
  })
})
