/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend, mockDestroy, capturedConfigs } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockDestroy: vi.fn(),
  capturedConfigs: [] as Record<string, unknown>[],
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    constructor(config: Record<string, unknown>) {
      capturedConfigs.push(config)
    }
    send = mockSend
    destroy = mockDestroy
  },
  PutMetricDataCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

import { POST } from '@/app/api/tools/cloudwatch/put-metric-data/route'

const body = {
  region: 'us-east-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
  namespace: 'Sim/Test',
  metricName: 'Requests',
  value: 1,
}

function postRoute() {
  return POST(createMockRequest('POST', body))
}

describe('cloudwatch put-metric-data delivery class', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedConfigs.length = 0
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockSend.mockResolvedValue({})
  })

  it('pins the client to a single attempt so the SDK cannot replay the datapoint', async () => {
    const response = await postRoute()

    expect(response.status).toBe(200)
    expect(capturedConfigs).toHaveLength(1)
    expect(capturedConfigs[0].maxAttempts).toBe(1)
  })

  it('never lets an ambiguous failure turn into a second PutMetricData', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }))

    const response = await postRoute()

    expect(response.status).toBe(500)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
