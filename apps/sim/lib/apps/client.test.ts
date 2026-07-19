import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishAppWithDeploy } from '@/lib/apps/client'

describe('publishAppWithDeploy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses one client operation ID after an ambiguous transport failure', async () => {
    const response = {
      operationId: '11111111-1111-4111-8111-111111111111',
      stage: 'published',
      releaseId: 'release-1',
      revisionId: 'revision-1',
      buildId: 'build-1',
      deployments: [{ workflowId: 'workflow-1', deploymentVersionId: 'version-1' }],
      state: 'published',
      recovery: {
        resumed: true,
        reusedDeployments: ['workflow-1'],
        reusedReboundRevision: true,
        reusedBuild: true,
        reusedRelease: true,
        reusedPublication: false,
      },
    }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-1111-4111-8111-111111111111',
    })

    await expect(publishAppWithDeploy({ projectId: 'project-1' })).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(firstBody.operationId).toBe('11111111-1111-4111-8111-111111111111')
    expect(secondBody.operationId).toBe(firstBody.operationId)
  })
})
