import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  docNotReady: vi.fn(),
  readGraph: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: mocks.docNotReady,
}))

vi.mock('@/lib/internal/whatsapp/client', () => ({
  readWhatsAppGraphResponse: mocks.readGraph,
}))

import { uploadWhatsAppMedia } from '@/lib/internal/whatsapp/upload'

const { mockProcessSingleFileToUserFile } = fileUtilsMockFns
const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

const file = { key: 'workspace/file', name: 'image.png', size: 4, type: 'image/png' }

describe('WhatsApp media upload', () => {
  beforeEach(() => {
    mockProcessSingleFileToUserFile.mockReturnValue(file)
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('data'),
      contentType: 'image/png',
    })
    mocks.readGraph.mockResolvedValue({ id: 'media-id' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
  })

  it('authorizes a Sim file before reading or sending it', async () => {
    const denied = Response.json({ success: false, error: 'File not found' }, { status: 404 })
    mockAssertToolFileAccess.mockResolvedValue(denied)

    const result = await uploadWhatsAppMedia({
      file,
      accessToken: 'token',
      phoneNumberId: 'phone-id',
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(result).toEqual({ ok: false, response: denied })
    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('enforces the media-type cap before downloading declared oversized files', async () => {
    mockProcessSingleFileToUserFile.mockReturnValue({ ...file, size: 5 * 1024 * 1024 + 1 })

    const result = await uploadWhatsAppMedia({
      file,
      accessToken: 'token',
      phoneNumberId: 'phone-id',
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(result).toMatchObject({ ok: false, status: 413 })
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })
})
