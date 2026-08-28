/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  match: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/brex/operations', () => ({
  executeBrexMatchReceipt: mocks.match,
  executeBrexUploadReceipt: mocks.upload,
}))

import { executeBrexTool } from '@/lib/internal/brex/execute-tool'
import { brexMatchReceiptTool } from '@/tools/brex/match_receipt'
import { brexUploadReceiptTool } from '@/tools/brex/upload_receipt'

const file = { key: 'uploads/receipt.pdf', name: 'receipt.pdf', size: 5 }
const context = { userId: 'user-1' }

describe('executeBrexTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.match.mockResolvedValue(Response.json({ success: true, output: {} }))
    mocks.upload.mockResolvedValue(Response.json({ success: true, output: {} }))
  })

  it.each([
    ['brex_match_receipt', mocks.match, { apiKey: 'token', file }],
    ['brex_upload_receipt', mocks.upload, { apiKey: 'token', expenseId: 'expense-1', file }],
  ])('dispatches %s through its typed operation', async (toolId, operation, input) => {
    await executeBrexTool({
      toolId,
      input,
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(operation).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ userId: 'user-1', requestId: 'request-1' })
    )
  })

  it('validates upload-only expense IDs without falling back to receipt matching', async () => {
    const response = await executeBrexTool({
      toolId: 'brex_upload_receipt',
      input: { apiKey: 'token', expenseId: '   ', file },
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.match).not.toHaveBeenCalled()
  })

  it('requires trusted execution identity before parsing', async () => {
    const response = await executeBrexTool({
      toolId: 'brex_match_receipt',
      input: {},
      headers: new Headers(),
      context: {},
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'Authentication required' })
  })

  it('awaits operation failures so the handler preserves its error envelope', async () => {
    mocks.match.mockRejectedValueOnce(new Error('provider unavailable'))

    const response = await executeBrexTool({
      toolId: 'brex_match_receipt',
      input: { apiKey: 'token', file },
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'provider unavailable',
    })
  })
})

describe('Brex receipt internal tool declarations', () => {
  it('keep provider credentials private while projecting the model-visible file reference', () => {
    expect(brexMatchReceiptTool).not.toHaveProperty('request')
    expect(brexUploadReceiptTool).not.toHaveProperty('request')

    const params = {
      apiKey: 'private-token',
      expenseId: 'expense-1',
      file,
      receiptName: 'dinner.pdf',
    }
    expect(brexUploadReceiptTool.operation.modelInput?.select?.(params)).toEqual({
      expenseId: 'expense-1',
      file,
      receiptName: 'dinner.pdf',
    })
    expect(brexUploadReceiptTool.operation.input(params)).toEqual(params)
    expect(brexMatchReceiptTool.operation.modelInput?.select?.(params)).toEqual({
      file,
      receiptName: 'dinner.pdf',
    })
  })
})
