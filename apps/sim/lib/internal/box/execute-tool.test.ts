import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upload: vi.fn() }))

vi.mock('@/lib/internal/box/operations', () => ({ executeBoxUploadFile: mocks.upload }))

import { boxUploadFileTool } from '@/tools/box/upload_file'

const file = { key: 'uploads/file.pdf', name: 'file.pdf', size: 5 }

describe('executeBoxTool', () => {
  beforeEach(() => {
    mocks.upload.mockResolvedValue(Response.json({ success: true, output: {} }))
  })

  it('uses only typed operation metadata and keeps OAuth and legacy content private', () => {
    expect(boxUploadFileTool).not.toHaveProperty('request')
    const params = {
      accessToken: 'private-token',
      parentFolderId: '0',
      file,
      fileContent: 'private-base64',
      fileName: 'override.pdf',
    }
    expect(boxUploadFileTool.operation.modelInput?.select?.(params)).toEqual({
      parentFolderId: '0',
      file,
      fileName: 'override.pdf',
    })
    expect(boxUploadFileTool.operation.input(params)).toEqual(params)
  })
})
