import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  match: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/brex/operations', () => ({
  executeBrexMatchReceipt: mocks.match,
  executeBrexUploadReceipt: mocks.upload,
}))

import { brexMatchReceiptTool } from '@/tools/brex/match_receipt'
import { brexUploadReceiptTool } from '@/tools/brex/upload_receipt'

const file = { key: 'uploads/receipt.pdf', name: 'receipt.pdf', size: 5 }

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
