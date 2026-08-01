/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadServableFileFromStorage, mockVerifyFileAccess } = vi.hoisted(() => ({
  mockDownloadServableFileFromStorage: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

import { readUserFileContent } from '@/lib/execution/payloads/materialization.server'
import type { UserFile } from '@/executor/types'

const PDF_SOURCE = Buffer.from('from reportlab.pdfgen import canvas')
const PDF_BYTES = Buffer.from('%PDF-1.4 rendered bytes')

const generatedPdf: UserFile = {
  id: 'file-1',
  name: 'report.pdf',
  url: '',
  size: PDF_SOURCE.length,
  type: 'text/x-python-pdf',
  key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/1700000000000-abc1234-report.pdf',
}

describe('readUserFileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generatedPdf.size = PDF_SOURCE.length
    mockVerifyFileAccess.mockResolvedValue(true)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: PDF_BYTES,
      contentType: 'application/pdf',
    })
  })

  it('returns the compiled artifact instead of the stored generation source', async () => {
    const content = await readUserFileContent(generatedPdf, {
      userId: 'user-1',
      encoding: 'base64',
    })

    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledOnce()
    expect(content).toBe(PDF_BYTES.toString('base64'))
    expect(content).not.toBe(PDF_SOURCE.toString('base64'))
    expect(generatedPdf.size).toBe(PDF_BYTES.length)
  })
})
