/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

import { DropboxClient, DropboxUploadError } from '@/lib/internal/dropbox/client'

describe('DropboxClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('preserves Dropbox content upload headers, flags, bytes, and output', async () => {
    const controller = new AbortController()
    const metadata = { id: 'dropbox-1', name: 'file.pdf', path_display: '/Reports/file.pdf' }
    mocks.fetch.mockResolvedValue(Response.json(metadata))
    const buffer = Buffer.from('file')
    const output = await new DropboxClient('token', controller.signal).upload(
      '/Reports/file.pdf',
      buffer,
      { mode: 'overwrite', autorename: true, mute: true }
    )

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://content.dropboxapi.com/2/files/upload')
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(controller.signal)
    expect(init.body).toEqual(new Uint8Array(buffer))
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer token')
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(JSON.parse(headers['Dropbox-API-Arg'])).toEqual({
      path: '/Reports/file.pdf',
      mode: 'overwrite',
      autorename: true,
      mute: true,
    })
    expect(output).toEqual(metadata)
  })

  it('preserves Dropbox provider status and error summary', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ error_summary: 'path/not_found/' }, { status: 409 })
    )
    const error = await new DropboxClient('token')
      .upload('/missing/file.pdf', Buffer.from('file'), {})
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DropboxUploadError)
    expect(error).toMatchObject({ message: 'path/not_found/', status: 409 })
  })
})
