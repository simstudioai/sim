import { filterUndefined } from '@sim/utils/object'
import Decimal from 'decimal.js'
import type {
  QuickBooksBillAllocationInput,
  QuickBooksCreateBillParams,
  QuickBooksCreateBillPaymentParams,
  QuickBooksCreatePurchaseOrderParams,
  QuickBooksCreatePurchaseParams,
  QuickBooksCreateVendorCreditParams,
  QuickBooksPurchasingLineInput,
  QuickBooksUpdateBillParams,
  QuickBooksUpdateBillPaymentParams,
  QuickBooksUpdatePurchaseOrderParams,
  QuickBooksUpdatePurchaseParams,
  QuickBooksUpdateVendorCreditParams,
} from '@/tools/quickbooks/types'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  quickBooksReference,
  requiredQuickBooksString,
  validateQuickBooksDate,
} from '@/tools/quickbooks/utils'

const MAX_PURCHASING_LINES = 100
const MAX_BILL_ALLOCATIONS = 100
const ACCOUNT_LINE_KEYS = new Set(['lineType', 'amount', 'accountId', 'description'])
const ITEM_LINE_KEYS = new Set([
  'lineType',
  'amount',
  'itemId',
  'description',
  'quantity',
  'unitPrice',
])
const BILL_ALLOCATION_KEYS = new Set(['billId', 'amount'])

function parseJsonArray(value: unknown, fieldName: string): unknown[] | undefined {
  if (value == null || value === '') return undefined
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${fieldName} must be valid JSON`)
    }
  }
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`)
  return parsed
}

function assertObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  fieldName: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key))
  if (unknownKey) throw new Error(`${fieldName} contains unsupported field "${unknownKey}"`)
}

function requiredPositiveNumber(value: unknown, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive finite number`)
  }
  return parsed
}

function optionalPositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (value == null || value === '') return undefined
  return requiredPositiveNumber(value, fieldName)
}

function requiredStringValue(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string`)
  return requiredQuickBooksString(value, fieldName)
}

function optionalStringValue(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string`)
  return optionalQuickBooksString(value)
}

export function parseQuickBooksPurchasingLines(
  value: unknown,
  fieldName = 'lines'
): QuickBooksPurchasingLineInput[] | undefined {
  const parsed = parseJsonArray(value, fieldName)
  if (!parsed) return undefined
  if (parsed.length === 0) throw new Error(`${fieldName} must contain at least one line`)
  if (parsed.length > MAX_PURCHASING_LINES) {
    throw new Error(`${fieldName} cannot contain more than ${MAX_PURCHASING_LINES} lines`)
  }

  return parsed.map((rawLine, index) => {
    const itemName = `${fieldName}[${index}]`
    const line = assertObject(rawLine, itemName)
    if (line.lineType === 'account') {
      assertAllowedKeys(line, ACCOUNT_LINE_KEYS, itemName)
      return {
        lineType: 'account',
        amount: requiredPositiveNumber(line.amount, `${itemName}.amount`),
        accountId: requiredStringValue(line.accountId, `${itemName}.accountId`),
        description: optionalStringValue(line.description, `${itemName}.description`),
      }
    }
    if (line.lineType !== 'item') {
      throw new Error(`${itemName}.lineType must be account or item`)
    }
    assertAllowedKeys(line, ITEM_LINE_KEYS, itemName)
    const amount = requiredPositiveNumber(line.amount, `${itemName}.amount`)
    const quantity = optionalPositiveNumber(line.quantity, `${itemName}.quantity`)
    const unitPrice = optionalPositiveNumber(line.unitPrice, `${itemName}.unitPrice`)
    if (
      quantity !== undefined &&
      unitPrice !== undefined &&
      !new Decimal(quantity).times(unitPrice).toDecimalPlaces(2).equals(new Decimal(amount))
    ) {
      throw new Error(`${itemName}.amount must equal quantity multiplied by unitPrice`)
    }
    return {
      lineType: 'item',
      amount,
      itemId: requiredStringValue(line.itemId, `${itemName}.itemId`),
      description: optionalStringValue(line.description, `${itemName}.description`),
      quantity,
      unitPrice,
    }
  })
}

export function buildQuickBooksPurchasingLines(lines: QuickBooksPurchasingLineInput[]): unknown[] {
  const validated = parseQuickBooksPurchasingLines(lines)
  if (!validated) throw new Error('lines are required')
  return validated.map((line) => {
    if (line.lineType === 'account') {
      return filterUndefined({
        Amount: line.amount,
        Description: line.description,
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: quickBooksReference(line.accountId!, 'accountId'),
        },
      })
    }
    return filterUndefined({
      Amount: line.amount,
      Description: line.description,
      DetailType: 'ItemBasedExpenseLineDetail',
      ItemBasedExpenseLineDetail: filterUndefined({
        ItemRef: quickBooksReference(line.itemId!, 'itemId'),
        Qty: line.quantity,
        UnitPrice: line.unitPrice,
      }),
    })
  })
}

export function parseQuickBooksBillAllocations(
  value: unknown,
  fieldName = 'billAllocations'
): QuickBooksBillAllocationInput[] | undefined {
  const parsed = parseJsonArray(value, fieldName)
  if (!parsed) return undefined
  if (parsed.length === 0) throw new Error(`${fieldName} must contain at least one allocation`)
  if (parsed.length > MAX_BILL_ALLOCATIONS) {
    throw new Error(`${fieldName} cannot contain more than ${MAX_BILL_ALLOCATIONS} allocations`)
  }
  const billIds = new Set<string>()
  return parsed.map((rawAllocation, index) => {
    const itemName = `${fieldName}[${index}]`
    const allocation = assertObject(rawAllocation, itemName)
    assertAllowedKeys(allocation, BILL_ALLOCATION_KEYS, itemName)
    const billId = requiredStringValue(allocation.billId, `${itemName}.billId`)
    if (billIds.has(billId)) throw new Error(`${fieldName} contains duplicate Bill ID "${billId}"`)
    billIds.add(billId)
    return {
      billId,
      amount: requiredPositiveNumber(allocation.amount, `${itemName}.amount`),
    }
  })
}

function buildBillPaymentLines(
  allocations: QuickBooksBillAllocationInput[],
  totalAmount: number
): unknown[] {
  const validated = parseQuickBooksBillAllocations(allocations)
  if (!validated) throw new Error('billAllocations are required')
  const allocationTotal = validated.reduce(
    (sum, allocation) => sum.plus(allocation.amount),
    new Decimal(0)
  )
  if (!allocationTotal.equals(new Decimal(totalAmount))) {
    throw new Error('Bill allocation amounts must equal totalAmount')
  }
  return validated.map((allocation) => ({
    Amount: allocation.amount,
    LinkedTxn: [{ TxnId: allocation.billId, TxnType: 'Bill' }],
  }))
}

function purchasingHeader(params: {
  vendorId?: string
  apAccountId?: string
  transactionDate?: string
  dueDate?: string
  documentNumber?: string
  privateNote?: string
}): Record<string, unknown> {
  return filterUndefined({
    VendorRef: params.vendorId ? quickBooksReference(params.vendorId, 'vendorId') : undefined,
    APAccountRef: params.apAccountId
      ? quickBooksReference(params.apAccountId, 'apAccountId')
      : undefined,
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    DueDate: validateQuickBooksDate(params.dueDate, 'dueDate'),
    DocNumber: optionalQuickBooksString(params.documentNumber),
    PrivateNote: optionalQuickBooksString(params.privateNote),
  })
}

export function buildQuickBooksCreatePurchaseOrderBody(
  params: QuickBooksCreatePurchaseOrderParams
): Record<string, unknown> {
  return {
    ...purchasingHeader(params),
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
    APAccountRef: quickBooksReference(params.apAccountId, 'apAccountId'),
    Line: buildQuickBooksPurchasingLines(params.lines),
  }
}

export function buildQuickBooksUpdatePurchaseOrderBody(
  params: QuickBooksUpdatePurchaseOrderParams
): Record<string, unknown> {
  const body = {
    Id: requiredQuickBooksString(params.purchaseOrderId, 'purchaseOrderId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    ...purchasingHeader(params),
  }
  assertQuickBooksSparseUpdate(body)
  return body
}

export function buildQuickBooksCreateBillBody(
  params: QuickBooksCreateBillParams
): Record<string, unknown> {
  return {
    ...purchasingHeader(params),
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
    Line: buildQuickBooksPurchasingLines(params.lines),
  }
}

export function buildQuickBooksUpdateBillBody(
  params: QuickBooksUpdateBillParams
): Record<string, unknown> {
  const body = {
    Id: requiredQuickBooksString(params.billId, 'billId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    ...purchasingHeader(params),
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
  }
  assertQuickBooksSparseUpdate(body, 4)
  return body
}

export function buildQuickBooksCreateBillPaymentBody(
  params: QuickBooksCreateBillPaymentParams
): Record<string, unknown> {
  const totalAmount = requiredPositiveNumber(params.totalAmount, 'totalAmount')
  const paymentAccountId = requiredQuickBooksString(params.paymentAccountId, 'paymentAccountId')
  const paymentDetails =
    params.paymentType === 'check'
      ? { PayType: 'Check', CheckPayment: { BankAccountRef: { value: paymentAccountId } } }
      : params.paymentType === 'credit_card'
        ? {
            PayType: 'CreditCard',
            CreditCardPayment: { CCAccountRef: { value: paymentAccountId } },
          }
        : (() => {
            throw new Error(
              `Unsupported QuickBooks BillPayment type: ${String(params.paymentType)}`
            )
          })()
  return {
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
    TotalAmt: totalAmount,
    ...paymentDetails,
    Line: buildBillPaymentLines(params.billAllocations, totalAmount),
    ...filterUndefined({
      TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
      PrivateNote: optionalQuickBooksString(params.privateNote),
    }),
  }
}

export function buildQuickBooksUpdateBillPaymentBody(
  params: QuickBooksUpdateBillPaymentParams
): Record<string, unknown> {
  const body = filterUndefined({
    Id: requiredQuickBooksString(params.billPaymentId, 'billPaymentId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    PrivateNote: optionalQuickBooksString(params.privateNote),
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body, 4)
  return body
}

export function buildQuickBooksCreateVendorCreditBody(
  params: QuickBooksCreateVendorCreditParams
): Record<string, unknown> {
  return {
    ...purchasingHeader(params),
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
    Line: buildQuickBooksPurchasingLines(params.lines),
  }
}

export function buildQuickBooksUpdateVendorCreditBody(
  params: QuickBooksUpdateVendorCreditParams
): Record<string, unknown> {
  const body = {
    Id: requiredQuickBooksString(params.vendorCreditId, 'vendorCreditId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    ...purchasingHeader(params),
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
  }
  assertQuickBooksSparseUpdate(body, 4)
  return body
}

function quickBooksPurchasePaymentType(paymentType: string): string {
  if (paymentType === 'cash') return 'Cash'
  if (paymentType === 'check') return 'Check'
  if (paymentType === 'credit_card') return 'CreditCard'
  throw new Error(`Unsupported QuickBooks Purchase payment type: ${paymentType}`)
}

export function buildQuickBooksCreatePurchaseBody(
  params: QuickBooksCreatePurchaseParams
): Record<string, unknown> {
  return filterUndefined({
    PaymentType: quickBooksPurchasePaymentType(params.paymentType),
    AccountRef: quickBooksReference(params.paymentAccountId, 'paymentAccountId'),
    EntityRef: params.vendorId
      ? { ...quickBooksReference(params.vendorId, 'vendorId'), type: 'Vendor' }
      : undefined,
    Line: buildQuickBooksPurchasingLines(params.lines),
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    PaymentRefNum: optionalQuickBooksString(params.paymentReference),
    PrivateNote: optionalQuickBooksString(params.privateNote),
  })
}

export function buildQuickBooksUpdatePurchaseBody(
  params: QuickBooksUpdatePurchaseParams
): Record<string, unknown> {
  const body = filterUndefined({
    Id: requiredQuickBooksString(params.purchaseId, 'purchaseId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    PaymentType: quickBooksPurchasePaymentType(params.currentPaymentType),
    EntityRef: params.vendorId
      ? { ...quickBooksReference(params.vendorId, 'vendorId'), type: 'Vendor' }
      : undefined,
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    PaymentRefNum: optionalQuickBooksString(params.paymentReference),
    PrivateNote: optionalQuickBooksString(params.privateNote),
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body, 4)
  return body
}
