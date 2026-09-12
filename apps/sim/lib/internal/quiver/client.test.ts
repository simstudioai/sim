/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/security/input-validation.server')>()),
  secureFetchWithValidation: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { requestQuiverSvg } from '@/lib/internal/quiver/client'

describe('Quiver client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('preserves provider URL, authentication, payload, and cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ data: [{ svg: '<svg />' }], id: 'generation-1' }))

    await expect(
      requestQuiverSvg(
        'generations',
        'secret',
        { model: 'arrow-preview', prompt: 'A compass' },
        controller.signal
      )
    ).resolves.toEqual({ data: [{ svg: '<svg />' }], id: 'generation-1' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.quiver.ai/v1/svgs/generations', {
      profile: 'configuredEndpoint',
      redirectPolicy: { mode: 'standard', sendCredentialsOnCrossOriginRedirect: false },
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
      body: JSON.stringify({ model: 'arrow-preview', prompt: 'A compass' }),
      signal: controller.signal,
    })
  })

  it('preserves provider error status and text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid model', { status: 422 }))

    await expect(
      requestQuiverSvg('vectorizations', 'secret', { model: 'bad' })
    ).rejects.toMatchObject({
      status: 422,
      body: { success: false, error: 'Quiver API error: 422 - invalid model' },
    })
  })

  it('bounds provider success and error bodies before buffering', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: { 'content-length': String(MAX_JSON_API_RESPONSE_BYTES + 1) },
        })
      )
      .mockResolvedValueOnce(
        new Response('error', {
          status: 500,
          headers: { 'content-length': String(64 * 1024 + 1) },
        })
      )

    await expect(requestQuiverSvg('generations', 'secret', {})).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
    })
    await expect(requestQuiverSvg('generations', 'secret', {})).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
    })
  })
})
