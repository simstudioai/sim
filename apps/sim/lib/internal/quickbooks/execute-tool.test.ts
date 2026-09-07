/**
 * @vitest-environment node
 */
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

const PROVIDER_OPERATIONS: ReadonlyArray<
  [string, ReturnType<typeof vi.fn>, Record<string, unknown>, Record<string, unknown>]
> = [
  [
    'quickbooks_create_bill_payment',
    mocks.createBillPayment,
    {
      vendorId: 'vendor-1',
      totalAmount: 25,
      paymentType: 'check',
      paymentAccountId: 'account-1',
    },
    { totalAmount: '25' },
  ],
  [
    'quickbooks_update_bill',
    mocks.updateBill,
    { billId: 'bill-1', syncToken: '3' },
    { billId: '' },
  ],
  [
    'quickbooks_update_bill_payment',
    mocks.updateBillPayment,
    { billPaymentId: 'bill-payment-1', syncToken: '3' },
    { billPaymentId: '' },
  ],
  [
    'quickbooks_update_credit_memo',
    mocks.updateCreditMemo,
    { transactionId: 'credit-memo-1', syncToken: '3' },
    { transactionId: '' },
  ],
  [
    'quickbooks_update_customer_payment',
    mocks.updateCustomerPayment,
    { paymentId: 'payment-1', syncToken: '3' },
    { paymentId: '' },
  ],
  [
    'quickbooks_update_employee',
    mocks.updateEmployee,
    { employeeId: 'employee-1', syncToken: '3' },
    { employeeId: '' },
  ],
  [
    'quickbooks_update_item',
    mocks.updateItem,
    { itemId: 'item-1', syncToken: '3' },
    { unitPrice: 'free' },
  ],
  [
    'quickbooks_update_purchase',
    mocks.updatePurchase,
    { purchaseId: 'purchase-1', syncToken: '3' },
    { purchaseId: '' },
  ],
  [
    'quickbooks_update_purchase_order',
    mocks.updatePurchaseOrder,
    { purchaseOrderId: 'purchase-order-1', syncToken: '3' },
    { purchaseOrderId: '' },
  ],
  [
    'quickbooks_update_refund_receipt',
    mocks.updateRefundReceipt,
    { transactionId: 'refund-receipt-1', syncToken: '3' },
    { transactionId: '' },
  ],
  [
    'quickbooks_update_vendor',
    mocks.updateVendor,
    { vendorId: 'vendor-1', syncToken: '3' },
    { syncToken: '' },
  ],
  [
    'quickbooks_update_vendor_credit',
    mocks.updateVendorCredit,
    { vendorCreditId: 'vendor-credit-1', syncToken: '3' },
    { vendorCreditId: '' },
  ],
]

describe('executeQuickBooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it.each(PROVIDER_OPERATIONS)(
    'dispatches %s through its internal provider operation',
    async (toolId, operation, operationInput) => {
      const controller = new AbortController()
      const operationRequest = request({
        toolId,
        input: { ...AUTH_INPUT, ...operationInput },
        signal: controller.signal,
      })

      const response = await executeQuickBooksTool(operationRequest)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        success: true,
        output: { id: 'entity-1' },
      })
      expect(operation).toHaveBeenCalledWith(
        { ...AUTH_INPUT, ...operationInput },
        controller.signal
      )
    }
  )

  it.each(PROVIDER_OPERATIONS)(
    'rejects %s input the contract refuses',
    async (toolId, operation, operationInput, invalidOverride) => {
      const response = await executeQuickBooksTool(
        request({ toolId, input: { ...AUTH_INPUT, ...operationInput, ...invalidOverride } })
      )

      expect(response.status).toBe(400)
      expect(operation).not.toHaveBeenCalled()
    }
  )

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

  it('rejects provider operations without trusted user identity', async () => {
    const response = await executeQuickBooksTool(
      request({
        toolId: 'quickbooks_update_vendor',
        input: { ...AUTH_INPUT, vendorId: 'vendor-1', syncToken: '3' },
        context: { workflowId: 'workflow-1' },
      })
    )

    expect(response.status).toBe(401)
    expect(mocks.updateVendor).not.toHaveBeenCalled()
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

  it('dispatches downloads with trusted execution context', async () => {
    const controller = new AbortController()

    const response = await executeQuickBooksTool(request({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(mocks.downloadDocument).toHaveBeenCalledWith(
      {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        documentKind: 'attachment',
        attachmentId: 'attachment-1',
      },
      {
        userId: 'user-1',
        requestId: 'request-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        signal: controller.signal,
      }
    )
  })

  it('rejects missing trusted user identity', async () => {
    const response = await executeQuickBooksTool(request({ context: { workflowId: 'workflow-1' } }))

    expect(response.status).toBe(401)
    expect(mocks.downloadDocument).not.toHaveBeenCalled()
  })

  it('rejects malformed provider input', async () => {
    const response = await executeQuickBooksTool(request({ input: { accessToken: '' } }))

    expect(response.status).toBe(400)
    expect(mocks.downloadDocument).not.toHaveBeenCalled()
  })

  it('rejects oversized operation input before dispatch', async () => {
    const response = await executeQuickBooksTool(
      request({
        input: {
          accessToken: 'token',
          realmId: '123',
          quickBooksEnvironment: 'sandbox',
          attachmentId: 'attachment-1',
          extra: 'x'.repeat(1024 * 1024 + 1),
        },
      })
    )

    expect(response.status).toBe(413)
    expect(mocks.downloadDocument).not.toHaveBeenCalled()
  })

  it('propagates cancellation before validation or provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeQuickBooksTool(request({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.downloadDocument).not.toHaveBeenCalled()
  })
})
