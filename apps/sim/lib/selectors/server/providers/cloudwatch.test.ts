/**
 * @vitest-environment node
 */
import { CloudWatchLogsServiceException } from '@aws-sdk/client-cloudwatch-logs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListCloudWatchLogGroups, mockListCloudWatchLogStreams } = vi.hoisted(() => ({
  mockListCloudWatchLogGroups: vi.fn(),
  mockListCloudWatchLogStreams: vi.fn(),
}))

vi.mock('@/tools/cloudwatch/listing', () => ({
  listCloudWatchLogGroups: mockListCloudWatchLogGroups,
  listCloudWatchLogStreams: mockListCloudWatchLogStreams,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { cloudWatchSelectorAttachments } from '@/lib/selectors/server/providers/cloudwatch'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function logGroupArgs(signal?: AbortSignal): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'cloudwatch.logGroups',
    context: {
      awsAccessKeyId: 'access-key',
      awsSecretAccessKey: 'secret-key',
      awsRegion: 'us-east-1',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

function logStreamArgs(): ExecuteServerSelectorArgs {
  const args = logGroupArgs()
  args.selectorKey = 'cloudwatch.logStreams'
  args.context.logGroupName = '/aws/lambda/example'
  return args
}

function cloudWatchError(status: number): CloudWatchLogsServiceException {
  return new CloudWatchLogsServiceException({
    name: 'CloudWatchLogsError',
    $fault: status >= 500 ? 'server' : 'client',
    $metadata: { httpStatusCode: status },
  })
}

describe('CloudWatch server selector adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [401, 'SelectorConnectionUnavailableError', 401],
    [403, 'SelectorConnectionUnavailableError', 403],
    [429, 'SelectorOptionsUnavailableError', 429],
    [500, 'SelectorOptionsUnavailableError', 502],
  ] as const)(
    'maps trusted AWS status %i to the safe selector taxonomy',
    async (status, name, safeStatus) => {
      mockListCloudWatchLogGroups.mockRejectedValueOnce(cloudWatchError(status))

      await expect(
        cloudWatchSelectorAttachments['cloudwatch.logGroups'].execute(logGroupArgs())
      ).rejects.toMatchObject({ name, status: safeStatus })
    }
  )

  it('does not trust a status-shaped unknown error', async () => {
    mockListCloudWatchLogGroups.mockRejectedValueOnce({ $metadata: { httpStatusCode: 401 } })

    await expect(
      cloudWatchSelectorAttachments['cloudwatch.logGroups'].execute(logGroupArgs())
    ).rejects.toMatchObject({ name: 'SelectorOptionsUnavailableError', status: 502 })
  })

  it('preserves caller cancellation', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)
    mockListCloudWatchLogGroups.mockRejectedValueOnce(abortError)

    await expect(
      cloudWatchSelectorAttachments['cloudwatch.logGroups'].execute(logGroupArgs(controller.signal))
    ).rejects.toBe(abortError)
  })

  it('returns null when a selected log group no longer exists', async () => {
    mockListCloudWatchLogGroups.mockResolvedValue({ items: [], pages: 1, truncated: false })
    const args = logGroupArgs()
    args.request = { kind: 'detail', id: '/aws/missing' }

    await expect(
      cloudWatchSelectorAttachments['cloudwatch.logGroups'].execute(args)
    ).resolves.toEqual({ kind: 'detail', item: null })
    expect(mockListCloudWatchLogGroups).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: '/aws/missing' })
    )
  })

  it.each([
    {
      selectorKey: 'cloudwatch.logGroups' as const,
      mockListing: mockListCloudWatchLogGroups,
      args: logGroupArgs,
      providerField: 'logGroupName' as const,
      binding: {},
    },
    {
      selectorKey: 'cloudwatch.logStreams' as const,
      mockListing: mockListCloudWatchLogStreams,
      args: logStreamArgs,
      providerField: 'logStreamName' as const,
      binding: { logGroupName: '/aws/lambda/example' },
    },
  ])('forwards opaque cursors for $selectorKey', async (testCase) => {
    testCase.mockListing.mockResolvedValueOnce({
      items: [{ [testCase.providerField]: 'target' }],
      pages: 20,
      truncated: true,
      nextToken: 'opaque::next+=',
    })
    const args = testCase.args()
    args.request = { kind: 'list', search: 'target', cursor: 'opaque::start+=' }

    await expect(
      cloudWatchSelectorAttachments[testCase.selectorKey].execute(args)
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'target', label: 'target' }],
      nextCursor: 'opaque::next+=',
    })
    expect(testCase.mockListing).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: 'target',
        nextToken: 'opaque::start+=',
        ...testCase.binding,
      })
    )
  })

  it('rejects an invalid region before invoking the AWS listing helper', async () => {
    const args = logGroupArgs()
    args.context.awsRegion = 'not-a-region'

    await expect(
      cloudWatchSelectorAttachments['cloudwatch.logGroups'].execute(args)
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(mockListCloudWatchLogGroups).not.toHaveBeenCalled()
    expect(mockListCloudWatchLogStreams).not.toHaveBeenCalled()
  })
})
