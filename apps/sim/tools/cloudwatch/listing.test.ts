/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCloudWatchLogsClient: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/cloudwatch/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/internal/cloudwatch/client')>()),
  createCloudWatchLogsClient: mocks.createCloudWatchLogsClient,
}))

import { listCloudWatchLogGroups, listCloudWatchLogStreams } from '@/tools/cloudwatch/listing'

const CREDENTIALS = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function mockTwentyPages(
  collection: 'logGroups' | 'logStreams',
  name: 'logGroupName' | 'logStreamName',
  finalToken: string
) {
  let page = 0
  mocks.send.mockImplementation(async () => {
    page += 1
    return {
      [collection]: [{ [name]: `item-${page}` }],
      nextToken: page === 20 ? finalToken : `page-${page + 1}`,
    }
  })
}

describe('CloudWatch shared listings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCloudWatchLogsClient.mockReturnValue({
      send: mocks.send,
      destroy: mocks.destroy,
    })
  })

  it('continues log groups from an opaque token and exposes page twenty continuation', async () => {
    mockTwentyPages('logGroups', 'logGroupName', 'opaque::group/after-20+=')

    const result = await listCloudWatchLogGroups({
      credentials: CREDENTIALS,
      prefix: '/aws/lambda/',
      nextToken: 'opaque::group/start+=',
      suppressTruncationLog: true,
    })

    expect(result).toMatchObject({
      pages: 20,
      truncated: true,
      nextToken: 'opaque::group/after-20+=',
    })
    expect(result.items).toHaveLength(20)
    expect(mocks.send).toHaveBeenCalledTimes(20)
    expect(mocks.send.mock.calls[0]?.[0].input).toMatchObject({
      logGroupNamePrefix: '/aws/lambda/',
      limit: 50,
      nextToken: 'opaque::group/start+=',
    })
  })

  it('continues streams within their group and prefix and exposes page twenty continuation', async () => {
    mockTwentyPages('logStreams', 'logStreamName', 'opaque::stream/after-20+=')

    const result = await listCloudWatchLogStreams({
      credentials: CREDENTIALS,
      logGroupName: '/aws/lambda/example',
      prefix: '2026/09/',
      nextToken: 'opaque::stream/start+=',
      suppressTruncationLog: true,
    })

    expect(result).toMatchObject({
      pages: 20,
      truncated: true,
      nextToken: 'opaque::stream/after-20+=',
    })
    expect(result.items).toHaveLength(20)
    expect(mocks.send).toHaveBeenCalledTimes(20)
    expect(mocks.send.mock.calls[0]?.[0].input).toMatchObject({
      logGroupName: '/aws/lambda/example',
      logStreamNamePrefix: '2026/09/',
      orderBy: 'LogStreamName',
      limit: 50,
      nextToken: 'opaque::stream/start+=',
    })
  })
})
