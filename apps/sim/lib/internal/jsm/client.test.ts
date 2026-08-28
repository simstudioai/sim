/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsmClient } from '@/lib/internal/jsm/client'
import type { JsmOperationError } from '@/lib/internal/jsm/errors'

describe('JsmClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forwards authorization, experimental opt-in, and cancellation to fetch', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const client = new JsmClient('cloud-id', 'secret-token')

    await client.json('https://api.atlassian.com/resource', { method: 'GET' }, controller.signal)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.signal).toBe(controller.signal)
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-ExperimentalApi': 'opt-in',
    })
  })

  it('preserves Atlassian status and provider details when requested', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"errorMessages":["Too many requests"]}', {
          status: 429,
          statusText: 'Too Many Requests',
        })
      )
    )
    const client = new JsmClient('cloud-id', 'secret-token')

    await expect(
      client.json('https://api.atlassian.com/resource', {}, undefined, true)
    ).rejects.toMatchObject<JsmOperationError>({
      status: 429,
      body: {
        error: expect.any(String),
        details: '{"errorMessages":["Too many requests"]}',
      },
    })
  })

  it('does not start a request with an already-aborted signal', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(
      new JsmClient('cloud-id', 'secret-token').json(
        'https://api.atlassian.com/resource',
        {},
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
