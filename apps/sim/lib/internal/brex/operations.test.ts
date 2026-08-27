/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientConstructed: vi.fn(),
  createTarget: vi.fn(),
  uploadReceipt: vi.fn(),
  processFiles: vi.fn(),
  downloadStorage: vi.fn(),
  assertAccess: vi.fn(),
}))

vi.mock('@/lib/internal/brex/client', () => {
  class BrexReceiptError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  class BrexReceiptClient {
    constructor(apiKey: string, signal?: AbortSignal) {
      mocks.clientConstructed(apiKey, signal)
    }

    createUploadTarget = mocks.createTarget
    uploadReceipt = mocks.uploadReceipt
  }
  return { BrexReceiptClient, BrexReceiptError }
})

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadStorage,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertAccess,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  executeBrexMatchReceipt,
  executeBrexUploadReceipt,
  MAX_BREX_RECEIPT_BYTES,
} from '@/lib/internal/brex/operations'

const rawFile = { key: 'uploads/receipt.pdf', name: 'receipt.pdf', size: 5 }
const userFile = { ...rawFile, type: 'application/pdf' }

describe('Brex receipt operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.processFiles.mockReturnValue([userFile])
    mocks.assertAccess.mockResolvedValue(null)
    mocks.downloadStorage.mockResolvedValue({
      buffer: Buffer.from('receipt-bytes'),
      contentType: 'application/pdf',
    })
    mocks.createTarget.mockResolvedValue({ id: 'receipt-1', uri: 'https://upload.example/file' })
    mocks.uploadReceipt.mockResolvedValue(undefined)
  })

  it('authorizes provenance and carries cancellation through matching and file upload', async () => {
    const controller = new AbortController()
    const response = await executeBrexMatchReceipt(
      { apiKey: 'token', file: rawFile, receiptName: 'dinner.pdf' },
      { userId: 'user-1', requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      userFile.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadStorage).toHaveBeenCalledWith(userFile, 'request-1', expect.anything(), {
      maxBytes: MAX_BREX_RECEIPT_BYTES,
      signal: controller.signal,
    })
    expect(mocks.clientConstructed).toHaveBeenCalledWith('token', controller.signal)
    expect(mocks.createTarget).toHaveBeenCalledWith('dinner.pdf', undefined)
    expect(mocks.uploadReceipt).toHaveBeenCalledWith(
      'https://upload.example/file',
      Buffer.from('receipt-bytes')
    )
    expect(await response.json()).toEqual({
      success: true,
      output: { receiptId: 'receipt-1', receiptName: 'dinner.pdf', expenseId: null },
    })
  })

  it('preserves expense upload semantics and trims the validated expense ID', async () => {
    const response = await executeBrexUploadReceipt(
      { apiKey: 'token', expenseId: 'expense-1', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(mocks.createTarget).toHaveBeenCalledWith('receipt.pdf', 'expense-1')
    expect(await response.json()).toEqual({
      success: true,
      output: { receiptId: 'receipt-1', receiptName: 'receipt.pdf', expenseId: 'expense-1' },
    })
  })

  it('does not load receipt bytes when file authorization fails', async () => {
    mocks.assertAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeBrexMatchReceipt(
      { apiKey: 'token', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mocks.downloadStorage).not.toHaveBeenCalled()
    expect(mocks.createTarget).not.toHaveBeenCalled()
  })

  it('preserves the 50 MB receipt error surface', async () => {
    mocks.downloadStorage.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'receipt',
        maxBytes: MAX_BREX_RECEIPT_BYTES,
        observedBytes: MAX_BREX_RECEIPT_BYTES + 1,
      })
    )
    const response = await executeBrexMatchReceipt(
      { apiKey: 'token', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Receipt file exceeds the 50 MB limit',
    })
    expect(mocks.createTarget).not.toHaveBeenCalled()
  })
})
