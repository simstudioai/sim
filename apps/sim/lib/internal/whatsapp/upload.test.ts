import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processFile: vi.fn(),
  assertAccess: vi.fn(),
  downloadFile: vi.fn(),
  docNotReady: vi.fn(),
  readGraph: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.processFile,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadFile,
}))

vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: mocks.docNotReady,
}))

vi.mock('@/lib/internal/whatsapp/client', () => ({
  readWhatsAppGraphResponse: mocks.readGraph,
}))

import { uploadWhatsAppMedia } from '@/lib/internal/whatsapp/upload'

const file = { key: 'workspace/file', name: 'image.png', size: 4, type: 'image/png' }

describe('WhatsApp media upload', () => {
  beforeEach(() => {
    mocks.processFile.mockReturnValue(file)
    mocks.assertAccess.mockResolvedValue(null)
    mocks.downloadFile.mockResolvedValue({ buffer: Buffer.from('data'), contentType: 'image/png' })
    mocks.readGraph.mockResolvedValue({ id: 'media-id' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
  })

  it('authorizes a Sim file before reading or sending it', async () => {
    const denied = Response.json({ success: false, error: 'File not found' }, { status: 404 })
    mocks.assertAccess.mockResolvedValue(denied)

    const result = await uploadWhatsAppMedia({
      file,
      accessToken: 'token',
      phoneNumberId: 'phone-id',
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(result).toEqual({ ok: false, response: denied })
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      'workspace/file',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('enforces the media-type cap before downloading declared oversized files', async () => {
    mocks.processFile.mockReturnValue({ ...file, size: 5 * 1024 * 1024 + 1 })

    const result = await uploadWhatsAppMedia({
      file,
      accessToken: 'token',
      phoneNumberId: 'phone-id',
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(result).toMatchObject({ ok: false, status: 413 })
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })
})
