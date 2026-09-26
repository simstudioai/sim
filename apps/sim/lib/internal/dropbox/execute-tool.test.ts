import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upload: vi.fn() }))

vi.mock('@/lib/internal/dropbox/operations', () => ({ executeDropboxUpload: mocks.upload }))

import { dropboxUploadTool } from '@/tools/dropbox/upload'

const file = { key: 'uploads/file.pdf', name: 'file.pdf', size: 5 }

describe('executeDropboxTool', () => {
  beforeEach(() => {
    mocks.upload.mockResolvedValue(Response.json({ success: true, output: {} }))
  })

  it('uses operation-only metadata and keeps OAuth, legacy content, and private options hidden', () => {
    expect(dropboxUploadTool).not.toHaveProperty('request')
    const params = {
      accessToken: 'private-token',
      path: ' /Reports/ ',
      file,
      fileContent: 'private-base64',
      fileName: 'file.pdf',
      mode: 'overwrite' as const,
      autorename: true,
      mute: true,
    }
    expect(dropboxUploadTool.operation.modelInput?.select?.(params)).toEqual({
      path: ' /Reports/ ',
      file,
      fileName: 'file.pdf',
    })
    expect(dropboxUploadTool.operation.input(params)).toEqual({
      ...params,
      path: '/Reports/',
    })
  })
})
