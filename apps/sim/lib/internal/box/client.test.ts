/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

import { BoxClient, BoxUploadError } from '@/lib/internal/box/client'

describe('BoxClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('uses Box multipart semantics and projects the exact output contract', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValue(
      Response.json({
        entries: [
          {
            id: 'box-1',
            name: 'file.pdf',
            size: 4,
            sha1: 'sha',
            created_at: 'created',
            modified_at: 'modified',
            parent: { id: '0', name: 'All Files' },
          },
        ],
      })
    )
    const output = await new BoxClient('token', controller.signal).upload(
      '0',
      'file.pdf',
      Buffer.from('file')
    )

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://upload.box.com/api/2.0/files/content')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer token' })
    expect(init.signal).toBe(controller.signal)
    const form = init.body as FormData
    expect(JSON.parse(String(form.get('attributes')))).toEqual({
      name: 'file.pdf',
      parent: { id: '0' },
    })
    expect((form.get('file') as File).name).toBe('file.pdf')
    expect(output).toEqual({
      id: 'box-1',
      name: 'file.pdf',
      size: 4,
      sha1: 'sha',
      createdAt: 'created',
      modifiedAt: 'modified',
      parentId: '0',
      parentName: 'All Files',
    })
  })

  it('preserves Box provider status and error message', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ message: 'Folder not found' }, { status: 404 }))
    const error = await new BoxClient('token')
      .upload('0', 'file.pdf', Buffer.from('file'))
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BoxUploadError)
    expect(error).toMatchObject({ message: 'Folder not found', status: 404 })
  })
})
