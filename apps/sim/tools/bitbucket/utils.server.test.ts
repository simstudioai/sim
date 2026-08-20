/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const {
  mockBackoffWithJitter,
  mockCreatePinnedFetchWithDispatcher,
  mockParseRetryAfter,
  mockSecureFetchWithPinnedIP,
  mockValidateUrlWithDNS,
} = vi.hoisted(() => ({
  mockBackoffWithJitter: vi.fn(() => 0),
  mockCreatePinnedFetchWithDispatcher: vi.fn(),
  mockParseRetryAfter: vi.fn((header: string | null) =>
    header === null ? null : Number(header) * 1000
  ),
  mockSecureFetchWithPinnedIP: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
}))

vi.mock('@sim/utils/retry', () => ({
  backoffWithJitter: mockBackoffWithJitter,
  parseRetryAfter: mockParseRetryAfter,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedFetchWithDispatcher: mockCreatePinnedFetchWithDispatcher,
  secureFetchWithPinnedIP: mockSecureFetchWithPinnedIP,
  validateUrlWithDNS: mockValidateUrlWithDNS,
}))

import {
  resolveBitbucketPullRequestRedirect,
  secureBitbucketRead,
} from '@/tools/bitbucket/utils.server'

function secureResponse(
  status: number,
  options: { retryAfter?: string; cancel?: ReturnType<typeof vi.fn> } = {}
) {
  const headers = {
    get: (name: string) =>
      name.toLowerCase() === 'retry-after' ? (options.retryAfter ?? null) : null,
    toRecord: () => (options.retryAfter ? { 'retry-after': options.retryAfter } : {}),
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers,
    body: options.cancel ? { cancel: options.cancel } : null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBackoffWithJitter.mockReturnValue(0)
  mockParseRetryAfter.mockImplementation((header: string | null) =>
    header === null ? null : Number(header) * 1000
  )
  mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
})

describe('secureBitbucketRead', () => {
  it('honors bounded Retry-After pacing for a retryable response', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(secureResponse(429, { retryAfter: '2', cancel }))
      .mockResolvedValueOnce(secureResponse(200))

    await expect(
      secureBitbucketRead('https://api.bitbucket.org/2.0/repositories/acme/demo', {}, 1024)
    ).resolves.toMatchObject({ status: 200 })

    expect(mockParseRetryAfter).toHaveBeenCalledWith('2', Number.POSITIVE_INFINITY)
    expect(mockBackoffWithJitter).toHaveBeenCalledWith(1, 2000, {
      baseMs: 500,
      maxMs: 30_000,
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
  })

  it('retries a narrowly classified transport failure', async () => {
    const timeout = Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' })
    mockSecureFetchWithPinnedIP
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(secureResponse(200))

    await expect(
      secureBitbucketRead('https://api.bitbucket.org/2.0/repositories/acme/demo', {}, 1024)
    ).resolves.toMatchObject({ status: 200 })
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['ordinary client response', secureResponse(403)],
    ['aborted request', new DOMException('Aborted', 'AbortError')],
    [
      'bounded response failure',
      new PayloadSizeLimitError({ label: 'response body', maxBytes: 1024, observedBytes: 2048 }),
    ],
  ])('does not retry a %s', async (_name, result) => {
    if (result instanceof Error) mockSecureFetchWithPinnedIP.mockRejectedValueOnce(result)
    else mockSecureFetchWithPinnedIP.mockResolvedValueOnce(result)

    const execution = secureBitbucketRead(
      'https://api.bitbucket.org/2.0/repositories/acme/demo',
      {},
      1024
    )
    if (result instanceof Error) await expect(execution).rejects.toBe(result)
    else await expect(execution).resolves.toMatchObject({ status: 403 })
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledOnce()
  })

  it('stops after the three-attempt safe-read budget', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue(secureResponse(503))

    await expect(
      secureBitbucketRead('https://api.bitbucket.org/2.0/repositories/acme/demo', {}, 1024)
    ).resolves.toMatchObject({ status: 503 })
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
  })

  it('forwards redirect and response-cap safety options on every attempt', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(secureResponse(200))

    await secureBitbucketRead(
      'https://api.bitbucket.org/2.0/repositories/acme/demo/src/hash/file',
      { Authorization: 'Bearer placeholder' },
      10 * 1024 * 1024,
      { stripAuthOnRedirect: true, maxRedirects: 0 }
    )

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/acme/demo/src/hash/file',
      '203.0.113.10',
      expect.objectContaining({
        maxResponseBytes: 10 * 1024 * 1024,
        maxRedirects: 0,
        stripAuthOnRedirect: true,
      })
    )
  })
})

describe('resolveBitbucketPullRequestRedirect', () => {
  it('cancels the manual redirect body before closing its pinned dispatcher', async () => {
    const order: string[] = []
    const cancel = vi.fn(async () => {
      order.push('cancel')
    })
    const close = vi.fn(async () => {
      order.push('close')
    })
    const pinnedFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location'
            ? 'https://api.bitbucket.org/2.0/repositories/acme/demo/diff/source-team/source-repo:6315b3bac849%0Decdc2efc4f27?from_pullrequest_id=7&topic=true'
            : null,
      },
      body: { cancel },
    })
    mockCreatePinnedFetchWithDispatcher.mockReturnValue({
      fetch: pinnedFetch,
      dispatcher: { close },
    })

    await expect(
      resolveBitbucketPullRequestRedirect(
        'https://api.bitbucket.org/2.0/repositories/acme/demo/pullrequests/7/diff',
        'acme',
        'demo',
        'diff',
        { Authorization: 'Bearer placeholder' },
        { targetQuery: { path: 'src/index.ts', binary: 'false' } }
      )
    ).resolves.toBe(
      'https://api.bitbucket.org/2.0/repositories/acme/demo/diff/source-team/source-repo:6315b3bac849%0Decdc2efc4f27?from_pullrequest_id=7&topic=true&path=src%2Findex.ts&binary=false'
    )
    expect(order).toEqual(['cancel', 'close'])
  })

  it('rejects redirect statuses other than the documented 302', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    mockCreatePinnedFetchWithDispatcher.mockReturnValue({
      fetch: vi.fn().mockResolvedValue({
        status: 307,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location'
              ? 'https://api.bitbucket.org/2.0/repositories/acme/demo/diff/main..feature'
              : null,
        },
        body: { cancel },
      }),
      dispatcher: { close },
    })

    await expect(
      resolveBitbucketPullRequestRedirect(
        'https://api.bitbucket.org/2.0/repositories/acme/demo/pullrequests/7/diff',
        'acme',
        'demo',
        'diff',
        { Authorization: 'Bearer placeholder' }
      )
    ).rejects.toThrow(/documented redirect/)
    expect(cancel).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
