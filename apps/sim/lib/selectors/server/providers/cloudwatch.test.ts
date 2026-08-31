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

function cloudWatchError(status: number): CloudWatchLogsServiceException {
  return new CloudWatchLogsServiceException({
    name: 'CloudWatchLogsError',
    $fault: status >= 500 ? 'server' : 'client',
    $metadata: { httpStatusCode: status },
  })
}

describe('CloudWatch server selector adapter errors', () => {
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
