/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getSocketServerUrl: () => 'http://realtime' }))
vi.mock('@/lib/core/config/env', () => ({ env: { INTERNAL_API_SECRET: 'secret' } }))

import { mergeEditIntoLiveFileDoc } from './notify'

describe('mergeEditIntoLiveFileDoc', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the edit to the realtime apply-edit endpoint with the api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await mergeEditIntoLiveFileDoc('file-1', '# hello')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://realtime/api/file-doc/apply-edit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'secret' }),
        body: JSON.stringify({ fileId: 'file-1', markdown: '# hello' }),
      })
    )
  })

  it('never throws when the realtime call fails (best-effort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket pod down')))
    await expect(mergeEditIntoLiveFileDoc('file-1', '# hello')).resolves.toBeUndefined()
  })

  it('never throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(mergeEditIntoLiveFileDoc('file-1', '# hello')).resolves.toBeUndefined()
  })
})
