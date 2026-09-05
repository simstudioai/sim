/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const TRAIL_ARN = 'arn:aws:cloudtrail:us-east-1:123456789012:trail/my-trail'
const EVENT_DATA_STORE_ARN =
  'arn:aws:cloudtrail:us-east-1:123456789012:eventdatastore/11111111-2222-3333-4444-555555555555'
const QUERY_ID = '11111111-2222-3333-4444-555555555555'

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

const TOOL_CASES = [
  [
    'cloudtrail_cancel_query',
    { ...CONNECTION, queryId: QUERY_ID },
    mockOperations.executeCloudtrailCancelQuery,
  ],
  [
    'cloudtrail_describe_query',
    { ...CONNECTION, queryId: QUERY_ID },
    mockOperations.executeCloudtrailDescribeQuery,
  ],
  ['cloudtrail_describe_trails', CONNECTION, mockOperations.executeCloudtrailDescribeTrails],
  [
    'cloudtrail_get_event_data_store',
    { ...CONNECTION, eventDataStore: EVENT_DATA_STORE_ARN },
    mockOperations.executeCloudtrailGetEventDataStore,
  ],
  [
    'cloudtrail_get_event_selectors',
    { ...CONNECTION, trailName: 'my-trail' },
    mockOperations.executeCloudtrailGetEventSelectors,
  ],
  [
    'cloudtrail_get_insight_selectors',
    { ...CONNECTION, trailName: 'my-trail' },
    mockOperations.executeCloudtrailGetInsightSelectors,
  ],
  [
    'cloudtrail_get_query_results',
    { ...CONNECTION, queryId: QUERY_ID },
    mockOperations.executeCloudtrailGetQueryResults,
  ],
  [
    'cloudtrail_get_trail',
    { ...CONNECTION, name: TRAIL_ARN },
    mockOperations.executeCloudtrailGetTrail,
  ],
  [
    'cloudtrail_get_trail_status',
    { ...CONNECTION, name: 'my-trail' },
    mockOperations.executeCloudtrailGetTrailStatus,
  ],
  [
    'cloudtrail_list_event_data_stores',
    CONNECTION,
    mockOperations.executeCloudtrailListEventDataStores,
  ],
  [
    'cloudtrail_list_tags',
    { ...CONNECTION, resourceIdList: [TRAIL_ARN] },
    mockOperations.executeCloudtrailListTags,
  ],
  ['cloudtrail_list_trails', CONNECTION, mockOperations.executeCloudtrailListTrails],
  ['cloudtrail_lookup_events', CONNECTION, mockOperations.executeCloudtrailLookupEvents],
  [
    'cloudtrail_start_query',
    { ...CONNECTION, queryStatement: 'SELECT eventID FROM eds LIMIT 1' },
    mockOperations.executeCloudtrailStartQuery,
  ],
] as const

describe('executeCloudtrailTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('routes %s to its operation', async (toolId, input, operation) => {
    operation.mockResolvedValue({ success: true, output: {} })

    const response = await executeCloudtrailTool(createRequest({ toolId, input }))

    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('rejects an unsupported tool id', async () => {
    const response = await executeCloudtrailTool(createRequest({ toolId: 'cloudtrail_nope' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported CloudTrail tool: cloudtrail_nope',
    })
  })

  it('rejects input that fails contract validation before calling the operation', async () => {
    const response = await executeCloudtrailTool(
      createRequest({
        toolId: 'cloudtrail_get_query_results',
        input: { ...CONNECTION, queryId: 'not-a-query-id' },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeCloudtrailGetQueryResults).not.toHaveBeenCalled()
  })

  it('rejects a lookup that names an attribute key without a value', async () => {
    const response = await executeCloudtrailTool(
      createRequest({
        toolId: 'cloudtrail_lookup_events',
        input: { ...CONNECTION, attributeKey: 'Username' },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeCloudtrailLookupEvents).not.toHaveBeenCalled()
  })

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

  it('surfaces an operation failure as a 500 with its message', async () => {
    mockOperations.executeCloudtrailLookupEvents.mockRejectedValue(new Error('Rate exceeded'))

    const response = await executeCloudtrailTool(
      createRequest({ toolId: 'cloudtrail_lookup_events' })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Rate exceeded' })
  })
})
