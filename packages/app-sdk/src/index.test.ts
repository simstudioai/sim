import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_REQUEST_BODY_MAX_BYTES, createSimClient, type SimRunResult } from './index'

describe('@sim/app-sdk', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the same preview request shape and channel nonce', async () => {
    const postMessage = vi.fn(
      async (): Promise<SimRunResult> => ({ success: true, outputs: { ok: true } })
    )
    const client = createSimClient({
      mode: 'preview',
      channelNonce: 'nonce-1',
      postMessage,
    })

    await expect(client.run('submit', { name: 'Ada' })).resolves.toEqual({
      success: true,
      outputs: { ok: true },
    })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sim.run',
        actionId: 'submit',
        input: { name: 'Ada' },
        nonce: 'nonce-1',
        requestId: expect.any(String),
      })
    )
  })

  it('rejects oversized requests before either transport runs', async () => {
    const postMessage = vi.fn()
    const client = createSimClient({ mode: 'preview', postMessage })

    await expect(
      client.run('submit', { payload: 'x'.repeat(APP_REQUEST_BODY_MAX_BYTES) })
    ).rejects.toThrow(`Request body exceeds ${APP_REQUEST_BODY_MAX_BYTES} bytes`)
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('uses the release-scoped same-origin action URL and abuse header', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: { success: true, executionId: 'exec-1', outputs: { result: 42 } },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = createSimClient({
      mode: 'published',
      config: {
        publicId: 'public-1',
        slug: 'demo',
        releaseId: 'release-1',
        gatewayOrigin: 'https://apps.example.com/',
      },
      getAbuseToken: () => 'abuse-token',
    })

    await expect(client.run('main action', {})).resolves.toMatchObject({
      success: true,
      executionId: 'exec-1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://apps.example.com/__sim/actions/releases/release-1/actions/main%20action',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-sim-apps-abuse-token': 'abuse-token',
        }),
      })
    )
  })
})
