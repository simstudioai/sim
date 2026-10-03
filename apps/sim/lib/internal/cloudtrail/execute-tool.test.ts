import { describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeCloudtrailCancelQuery: vi.fn(),
  executeCloudtrailDescribeQuery: vi.fn(),
  executeCloudtrailDescribeTrails: vi.fn(),
  executeCloudtrailGetEventDataStore: vi.fn(),
  executeCloudtrailGetEventSelectors: vi.fn(),
  executeCloudtrailGetInsightSelectors: vi.fn(),
  executeCloudtrailGetQueryResults: vi.fn(),
  executeCloudtrailGetTrail: vi.fn(),
  executeCloudtrailGetTrailStatus: vi.fn(),
  executeCloudtrailListEventDataStores: vi.fn(),
  executeCloudtrailListTags: vi.fn(),
  executeCloudtrailListTrails: vi.fn(),
  executeCloudtrailLookupEvents: vi.fn(),
  executeCloudtrailStartQuery: vi.fn(),
}))

vi.mock('@/lib/internal/cloudtrail/operations', () => mockOperations)

import { executeCloudtrailTool } from '@/lib/internal/cloudtrail/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'cloudtrail_list_trails',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeCloudtrailTool', () => {
  it('rejects a region outside the documented AWS partitions', async () => {
    const response = await executeCloudtrailTool(
      createRequest({ toolId: 'cloudtrail_list_trails', input: { ...CONNECTION, region: 'nope' } })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeCloudtrailListTrails).not.toHaveBeenCalled()
  })

  it('accepts GovCloud and China partition regions', async () => {
    mockOperations.executeCloudtrailListTrails.mockResolvedValue({ success: true, output: {} })

    for (const region of ['us-gov-west-1', 'cn-north-1']) {
      const response = await executeCloudtrailTool(
        createRequest({ toolId: 'cloudtrail_list_trails', input: { ...CONNECTION, region } })
      )
      expect(response.status).toBe(200)
    }

    expect(mockOperations.executeCloudtrailListTrails).toHaveBeenCalledTimes(2)
  })
})
