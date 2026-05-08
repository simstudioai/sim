/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateDeploymentQueries, refetchDeploymentBoundary } from '@/hooks/queries/deployments'
import { fetchDeploymentVersionState } from '@/hooks/queries/utils/fetch-deployment-version-state'

describe('deployment query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates the deployment info, state, versions, and public surface queries', async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }

    await invalidateDeploymentQueries(queryClient as any, 'wf-1')

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(5)
    expect(queryClient.invalidateQueries.mock.calls.map(([call]) => call)).toEqual(
      expect.arrayContaining([
        { queryKey: ['deployments', 'info', 'wf-1'] },
        { queryKey: ['deployments', 'deployedState', 'wf-1'] },
        { queryKey: ['deployments', 'versions', 'wf-1'] },
        { queryKey: ['deployments', 'chatStatus', 'wf-1'] },
        { queryKey: ['deployments', 'formStatus', 'wf-1'] },
      ])
    )
  })

  it('refetches the deploy comparison boundary after invalidating it', async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      refetchQueries: vi.fn().mockResolvedValue(undefined),
    }

    await refetchDeploymentBoundary(queryClient as any, 'wf-1')

    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['deployments', 'info', 'wf-1'],
    })
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['deployments', 'deployedState', 'wf-1'],
    })
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['workflows', 'state', 'wf-1'],
    })
  })

  it('fetches deployment version state through the shared helper', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          deployedState: { blocks: {}, edges: [], loops: {}, parallels: {}, lastSaved: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    ) as typeof fetch

    await expect(fetchDeploymentVersionState('wf-1', 3)).resolves.toEqual({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      lastSaved: 1,
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/workflows/wf-1/deployments/3', {
      method: 'GET',
      headers: {},
      body: undefined,
      signal: undefined,
    })
  })
})
