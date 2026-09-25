import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCloudTrailClient: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/cloudtrail/client', () => ({
  createCloudTrailClient: mocks.createCloudTrailClient,
}))

import { executeCloudtrailLookupEvents } from '@/lib/internal/cloudtrail/operations'

const CONNECTION = {
  region: 'eu-west-2',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('CloudTrail operations', () => {
  beforeEach(() => {
    mocks.createCloudTrailClient.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
  })

  it('preserves an unparseable CloudTrailEvent as the raw string rather than dropping it', async () => {
    mocks.send.mockResolvedValue({ Events: [{ EventId: 'event-1', CloudTrailEvent: 'not json' }] })

    const result = await executeCloudtrailLookupEvents(CONNECTION)

    expect(result.output.events[0].cloudTrailEvent).toBeNull()
    expect(result.output.events[0].cloudTrailEventRaw).toBe('not json')
  })
})
