/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { describeLogGroups, describeLogStreams } from '@/app/api/tools/cloudwatch/utils'

describe('describeLogGroups', () => {
  it('preserves bounded pagination and normalized provider mapping', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: 'api', arn: 'arn:api', storedBytes: 12 }],
        nextToken: 'next-page',
      })
      .mockResolvedValueOnce({
        logGroups: [{ logGroupName: 'worker' }],
      })

    const result = await describeLogGroups({ send } as never, { prefix: 'a' })

    expect(result).toEqual({
      logGroups: [
        {
          logGroupName: 'api',
          arn: 'arn:api',
          storedBytes: 12,
          retentionInDays: undefined,
          creationTime: undefined,
        },
        {
          logGroupName: 'worker',
          arn: '',
          storedBytes: 0,
          retentionInDays: undefined,
          creationTime: undefined,
        },
      ],
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0].input).toMatchObject({
      logGroupNamePrefix: 'a',
      limit: 50,
    })
    expect(send.mock.calls[1][0].input).toMatchObject({ nextToken: 'next-page' })
  })

  it('treats limit as a total cap', async () => {
    const send = vi.fn().mockResolvedValue({
      logGroups: [{ logGroupName: 'one' }, { logGroupName: 'two' }],
      nextToken: 'unused',
    })

    const result = await describeLogGroups({ send } as never, { limit: 1 })

    expect(result.logGroups).toHaveLength(1)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].input.limit).toBe(1)
  })
})

describe('describeLogStreams', () => {
  it('preserves bounded pagination and prefix ordering', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        logStreams: [{ logStreamName: 'api/one', storedBytes: 12 }],
        nextToken: 'next-page',
      })
      .mockResolvedValueOnce({ logStreams: [{ logStreamName: 'api/two' }] })

    const result = await describeLogStreams({ send } as never, 'group', { prefix: 'api/' })

    expect(result.logStreams.map(({ logStreamName }) => logStreamName)).toEqual([
      'api/one',
      'api/two',
    ])
    expect(send.mock.calls[0][0].input).toMatchObject({
      logGroupName: 'group',
      logStreamNamePrefix: 'api/',
      orderBy: 'LogStreamName',
      limit: 50,
    })
    expect(send.mock.calls[1][0].input).toMatchObject({ nextToken: 'next-page' })
  })
})
