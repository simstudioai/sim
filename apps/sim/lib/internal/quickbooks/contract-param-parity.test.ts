/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  quickBooksAddAttachmentContract,
  quickBooksCreateBillPaymentContract,
  quickBooksDownloadDocumentContract,
  quickBooksUpdateBillContract,
  quickBooksUpdateBillPaymentContract,
  quickBooksUpdateCreditMemoContract,
  quickBooksUpdateCustomerPaymentContract,
  quickBooksUpdateEmployeeContract,
  quickBooksUpdateItemContract,
  quickBooksUpdatePurchaseContract,
  quickBooksUpdatePurchaseOrderContract,
  quickBooksUpdateRefundReceiptContract,
  quickBooksUpdateVendorContract,
  quickBooksUpdateVendorCreditContract,
} from '@/lib/api/contracts/tools/quickbooks'
import { quickbooksAddAttachmentTool } from '@/tools/quickbooks/add_attachment'
import { quickbooksCreateBillPaymentTool } from '@/tools/quickbooks/create_bill_payment'
import { quickbooksDownloadAttachmentTool } from '@/tools/quickbooks/download_attachment'
import { quickbooksDownloadTransactionPdfTool } from '@/tools/quickbooks/download_transaction_pdf'
import { quickbooksUpdateBillTool } from '@/tools/quickbooks/update_bill'
import { quickbooksUpdateBillPaymentTool } from '@/tools/quickbooks/update_bill_payment'
import { quickbooksUpdateCreditMemoTool } from '@/tools/quickbooks/update_credit_memo'
import { quickbooksUpdateCustomerPaymentTool } from '@/tools/quickbooks/update_customer_payment'
import { quickbooksUpdateEmployeeTool } from '@/tools/quickbooks/update_employee'
import { quickbooksUpdateItemTool } from '@/tools/quickbooks/update_item'
import { quickbooksUpdatePurchaseTool } from '@/tools/quickbooks/update_purchase'
import { quickbooksUpdatePurchaseOrderTool } from '@/tools/quickbooks/update_purchase_order'
import { quickbooksUpdateRefundReceiptTool } from '@/tools/quickbooks/update_refund_receipt'
import { quickbooksUpdateVendorTool } from '@/tools/quickbooks/update_vendor'
import { quickbooksUpdateVendorCreditTool } from '@/tools/quickbooks/update_vendor_credit'

/**
 * A contract body is a Zod object, so any key it does not declare is STRIPPED
 * before the provider operation runs — silently, with no validation error. A
 * tool param that the contract omits is therefore dead: the user fills it in,
 * the block forwards it, and it never reaches Intuit.
 */
const CONTRACT_BOUND_OPERATIONS = [
  ['create_bill_payment', quickbooksCreateBillPaymentTool, quickBooksCreateBillPaymentContract],
  ['update_bill', quickbooksUpdateBillTool, quickBooksUpdateBillContract],
  ['update_bill_payment', quickbooksUpdateBillPaymentTool, quickBooksUpdateBillPaymentContract],
  ['update_credit_memo', quickbooksUpdateCreditMemoTool, quickBooksUpdateCreditMemoContract],
  [
    'update_customer_payment',
    quickbooksUpdateCustomerPaymentTool,
    quickBooksUpdateCustomerPaymentContract,
  ],
  ['update_employee', quickbooksUpdateEmployeeTool, quickBooksUpdateEmployeeContract],
  ['update_item', quickbooksUpdateItemTool, quickBooksUpdateItemContract],
  ['update_purchase', quickbooksUpdatePurchaseTool, quickBooksUpdatePurchaseContract],
  [
    'update_purchase_order',
    quickbooksUpdatePurchaseOrderTool,
    quickBooksUpdatePurchaseOrderContract,
  ],
  [
    'update_refund_receipt',
    quickbooksUpdateRefundReceiptTool,
    quickBooksUpdateRefundReceiptContract,
  ],
  ['update_vendor', quickbooksUpdateVendorTool, quickBooksUpdateVendorContract],
  ['update_vendor_credit', quickbooksUpdateVendorCreditTool, quickBooksUpdateVendorCreditContract],
] as const

/**
 * The file operations do not expose a flat `shape`: the download body is a
 * discriminated union (one option per `documentKind`) and the add-attachment
 * body carries a `superRefine`. Their declared keys are still introspectable,
 * so they are held to the same parity rule as the JSON operations.
 */
const FILE_OPERATIONS = [
  [
    'download_attachment',
    quickbooksDownloadAttachmentTool,
    unionOptionKeys(quickBooksDownloadDocumentContract.body, 'attachment'),
  ],
  [
    'download_transaction_pdf',
    quickbooksDownloadTransactionPdfTool,
    unionOptionKeys(quickBooksDownloadDocumentContract.body, 'transaction_pdf'),
  ],
  [
    'add_attachment',
    quickbooksAddAttachmentTool,
    new Set(
      Object.keys(
        (quickBooksAddAttachmentContract.body as unknown as { shape: Record<string, unknown> })
          .shape
      )
    ),
  ],
] as const

/** Keys declared by the union option whose `documentKind` literal matches. */
function unionOptionKeys(body: unknown, documentKind: string): Set<string> {
  const options = (body as { options: Array<{ shape: Record<string, { value?: string }> }> })
    .options
  const option = options.find((candidate) => candidate.shape.documentKind?.value === documentKind)
  if (!option) throw new Error(`No download contract option for documentKind ${documentKind}`)
  return new Set(Object.keys(option.shape))
}

describe('QuickBooks contract/tool param parity', () => {
  it.each(CONTRACT_BOUND_OPERATIONS)(
    '%s declares every tool param in its contract body',
    (_name, tool, contract) => {
      const bodyShape = (contract.body as unknown as { shape: Record<string, unknown> }).shape
      const declared = new Set(Object.keys(bodyShape))
      const dropped = Object.keys(tool.params).filter((param) => !declared.has(param))
      expect(dropped).toEqual([])
    }
  )

  it.each(FILE_OPERATIONS)(
    '%s declares every tool param in its contract body',
    (_n, tool, declared) => {
      const dropped = Object.keys(tool.params).filter((param) => !declared.has(param))
      expect(dropped).toEqual([])
    }
  )
})
