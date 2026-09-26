import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addAttachment: vi.fn(),
  createBillPayment: vi.fn(),
  downloadDocument: vi.fn(),
  updateBill: vi.fn(),
  updateBillPayment: vi.fn(),
  updateCreditMemo: vi.fn(),
  updateCustomerPayment: vi.fn(),
  updateEmployee: vi.fn(),
  updateItem: vi.fn(),
  updatePurchase: vi.fn(),
  updatePurchaseOrder: vi.fn(),
  updateRefundReceipt: vi.fn(),
  updateVendor: vi.fn(),
  updateVendorCredit: vi.fn(),
}))

vi.mock('@/lib/internal/quickbooks/operations', () => ({
  QuickBooksInternalOperationError: class QuickBooksInternalOperationError extends Error {
    constructor(
      readonly status: number,
      message: string
    ) {
      super(message)
    }
  },
  executeQuickBooksAddAttachment: mocks.addAttachment,
  executeQuickBooksDownloadDocument: mocks.downloadDocument,
}))

vi.mock('@/lib/internal/quickbooks/provider-operations', () => ({
  executeQuickBooksCreateBillPaymentOperation: mocks.createBillPayment,
  executeQuickBooksUpdateBillOperation: mocks.updateBill,
  executeQuickBooksUpdateBillPaymentOperation: mocks.updateBillPayment,
  executeQuickBooksUpdateCreditMemoOperation: mocks.updateCreditMemo,
  executeQuickBooksUpdateCustomerPaymentOperation: mocks.updateCustomerPayment,
  executeQuickBooksUpdateEmployeeOperation: mocks.updateEmployee,
  executeQuickBooksUpdateItemOperation: mocks.updateItem,
  executeQuickBooksUpdatePurchaseOperation: mocks.updatePurchase,
  executeQuickBooksUpdatePurchaseOrderOperation: mocks.updatePurchaseOrder,
  executeQuickBooksUpdateRefundReceiptOperation: mocks.updateRefundReceipt,
  executeQuickBooksUpdateVendorCreditOperation: mocks.updateVendorCredit,
  executeQuickBooksUpdateVendorOperation: mocks.updateVendor,
}))

import { executeQuickBooksTool } from '@/lib/internal/quickbooks/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'quickbooks_download_attachment',
    input: {
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      attachmentId: 'attachment-1',
    },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const AUTH_INPUT = {
  accessToken: 'token',
  realmId: '123',
  quickBooksEnvironment: 'sandbox',
} as const

describe('executeQuickBooksTool', () => {
  beforeEach(() => {
    mocks.addAttachment.mockResolvedValue({ attachmentId: 'attachment-1' })
    mocks.downloadDocument.mockResolvedValue({ attachmentId: 'attachment-1' })
    for (const operation of [
      mocks.createBillPayment,
      mocks.updateBill,
      mocks.updateBillPayment,
      mocks.updateCreditMemo,
      mocks.updateCustomerPayment,
      mocks.updateEmployee,
      mocks.updateItem,
      mocks.updatePurchase,
      mocks.updatePurchaseOrder,
      mocks.updateRefundReceipt,
      mocks.updateVendor,
      mocks.updateVendorCredit,
    ]) {
      operation.mockResolvedValue({
        success: true,
        output: { id: 'entity-1' },
      })
    }
  })

  it('drops keys no provider operation contract declares', async () => {
    const response = await executeQuickBooksTool(
      request({
        toolId: 'quickbooks_update_vendor',
        input: { ...AUTH_INPUT, vendorId: 'vendor-1', syncToken: '3', credential: 'credential-1' },
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.updateVendor).toHaveBeenCalledWith(
      { ...AUTH_INPUT, vendorId: 'vendor-1', syncToken: '3' },
      undefined
    )
  })

  it('rejects oversized provider operation input before dispatch', async () => {
    const response = await executeQuickBooksTool(
      request({
        toolId: 'quickbooks_update_vendor',
        input: {
          ...AUTH_INPUT,
          vendorId: 'vendor-1',
          syncToken: '3',
          extra: 'x'.repeat(1024 * 1024 + 1),
        },
      })
    )

    expect(response.status).toBe(413)
    expect(mocks.updateVendor).not.toHaveBeenCalled()
  })
})
