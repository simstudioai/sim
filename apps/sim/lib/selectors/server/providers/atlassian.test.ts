/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchProviderJsonWithStatus, mockRetryWithExponentialBackoff } = vi.hoisted(() => ({
  mockFetchProviderJsonWithStatus: vi.fn(),
  mockRetryWithExponentialBackoff: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/provider-http', () => ({
  fetchProviderJsonWithStatus: mockFetchProviderJsonWithStatus,
  RetryableProviderNetworkError: class RetryableProviderNetworkError extends Error {},
}))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  retryWithExponentialBackoff: mockRetryWithExponentialBackoff,
}))

import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorAtlassianCloudId } from '@/lib/selectors/server/providers/atlassian'
import { RetryableProviderNetworkError } from '@/lib/selectors/server/providers/provider-http'

describe('Atlassian server selector authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRetryWithExponentialBackoff.mockImplementation(async (operation: () => Promise<unknown>) =>
      operation()
    )
  })

  it('accepts only a service-account cloud id bound to the selected domain', async () => {
    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'https://ACME.atlassian.net/',
        providedCloudId: 'cloud-1',
        providedDomain: 'acme.atlassian.net',
        product: 'Jira',
      })
    ).resolves.toBe('cloud-1')
    expect(mockFetchProviderJsonWithStatus).not.toHaveBeenCalled()

    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'other.atlassian.net',
        providedCloudId: 'cloud-1',
        providedDomain: 'acme.atlassian.net',
        product: 'Jira',
      })
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mockFetchProviderJsonWithStatus).not.toHaveBeenCalled()
  })

  it.each(['Jira', 'Confluence'] as const)(
    'rejects a sole other OAuth site for an explicitly configured %s domain',
    async (product) => {
      mockFetchProviderJsonWithStatus.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: 'other-cloud', url: 'https://other.atlassian.net' }],
      })

      await expect(
        resolveSelectorAtlassianCloudId({
          accessToken: 'server-only-token',
          domain: 'acme.atlassian.net',
          product,
        })
      ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    }
  )

  it.each([
    { name: 'one site', resources: [{ id: 'cloud-1', url: 'https://acme.atlassian.net' }] },
    {
      name: 'multiple sites',
      resources: [
        { id: 'other-cloud', url: 'https://other.atlassian.net' },
        { id: 'cloud-1', url: 'https://acme.atlassian.net' },
      ],
    },
  ])('selects the normalized configured OAuth site from $name', async ({ resources }) => {
    mockFetchProviderJsonWithStatus.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: resources,
    })

    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: ' https://ACME.atlassian.net/ ',
        product: 'Jira',
      })
    ).resolves.toBe('cloud-1')
  })

  it('passes only transient statuses into the bounded retry path', async () => {
    mockRetryWithExponentialBackoff.mockImplementation(
      async (operation: () => Promise<unknown>) => {
        await expect(operation()).rejects.toMatchObject({ status: 503, retryAfterMs: 1 })
        return operation()
      }
    )
    mockFetchProviderJsonWithStatus
      .mockResolvedValueOnce({ ok: false, status: 503, retryAfterMs: 1 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: 'cloud-1', url: 'acme.atlassian.net' }],
      })

    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'acme.atlassian.net',
        product: 'Jira',
      })
    ).resolves.toBe('cloud-1')

    expect(mockFetchProviderJsonWithStatus).toHaveBeenCalledTimes(2)
    const retryOptions = mockRetryWithExponentialBackoff.mock.calls[0]?.[1]
    expect(retryOptions).toMatchObject({ signal: undefined })
    expect(retryOptions.retryCondition(new DOMException('timed out', 'TimeoutError'))).toBe(true)
    expect(retryOptions.retryCondition(new DOMException('cancelled', 'AbortError'))).toBe(false)
    expect(mockFetchProviderJsonWithStatus.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('retries a concealed network failure without retrying caller cancellation', async () => {
    mockRetryWithExponentialBackoff.mockImplementation(
      async (operation: () => Promise<unknown>) => {
        await expect(operation()).rejects.toBeInstanceOf(RetryableProviderNetworkError)
        return operation()
      }
    )
    mockFetchProviderJsonWithStatus
      .mockRejectedValueOnce(new RetryableProviderNetworkError())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: 'cloud-1', url: 'acme.atlassian.net' }],
      })

    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'acme.atlassian.net',
        product: 'Jira',
      })
    ).resolves.toBe('cloud-1')

    const retryOptions = mockRetryWithExponentialBackoff.mock.calls[0]?.[1]
    expect(retryOptions.retryCondition(new RetryableProviderNetworkError())).toBe(true)
    expect(mockFetchProviderJsonWithStatus.mock.calls[0]?.[2]).toMatchObject({
      passthroughNetworkErrors: true,
    })
  })

  it('preserves caller cancellation through discovery retries', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)
    mockRetryWithExponentialBackoff.mockRejectedValueOnce(abortError)

    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'acme.atlassian.net',
        product: 'Jira',
        signal: controller.signal,
      })
    ).rejects.toBe(abortError)
  })

  it('preserves the safe rate-limit category after retries are exhausted', async () => {
    mockFetchProviderJsonWithStatus.mockResolvedValueOnce({ ok: false, status: 429 })

    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'acme.atlassian.net',
        product: 'Jira',
      })
    ).rejects.toEqual(new SelectorOptionsUnavailableError(429))
  })
})
