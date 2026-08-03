import { filterUndefined } from '@sim/utils/object'
import Decimal from 'decimal.js'
import type {
  QuickBooksCreateCustomerPaymentParams,
  QuickBooksCreateSalesDocumentParams,
  QuickBooksInvoiceAllocationInput,
  QuickBooksSalesLineInput,
  QuickBooksUpdateCustomerPaymentParams,
  QuickBooksUpdateSalesDocumentParams,
} from '@/tools/quickbooks/types'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  quickBooksReference,
  requiredQuickBooksString,
  validateQuickBooksDate,
} from '@/tools/quickbooks/utils'

const MAX_SALES_LINES = 100
const MAX_PAYMENT_ALLOCATIONS = 100
const ITEM_LINE_KEYS = new Set([
  'lineType',
  'amount',
  'itemId',
  'description',
  'quantity',
  'unitPrice',
  'serviceDate',
])
const DESCRIPTION_LINE_KEYS = new Set(['lineType', 'description'])
const PAYMENT_ALLOCATION_KEYS = new Set(['invoiceId', 'amount'])

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
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive finite number`)
  }
  return parsed
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

export function parseQuickBooksSalesLines(
  value: unknown,
  fieldName = 'lines'
): QuickBooksSalesLineInput[] | undefined {
  const parsed = parseJsonArray(value, fieldName)
  if (!parsed) return undefined
  if (parsed.length === 0) throw new Error(`${fieldName} must contain at least one line`)
  if (parsed.length > MAX_SALES_LINES) {
    throw new Error(`${fieldName} cannot contain more than ${MAX_SALES_LINES} lines`)
  }

  return parsed.map((rawLine, index) => {
    const itemName = `${fieldName}[${index}]`
    const line = assertObject(rawLine, itemName)
    if (line.lineType === 'description') {
      assertAllowedKeys(line, DESCRIPTION_LINE_KEYS, itemName)
      return {
        lineType: 'description',
        description: requiredStringValue(line.description, `${itemName}.description`),
      }
    }
    if (line.lineType !== 'item') {
      throw new Error(`${itemName}.lineType must be item or description`)
    }
    assertAllowedKeys(line, ITEM_LINE_KEYS, itemName)
    const description = optionalStringValue(line.description, `${itemName}.description`)
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
      description,
      quantity,
      unitPrice,
      serviceDate: validateQuickBooksDate(
        optionalStringValue(line.serviceDate, `${itemName}.serviceDate`),
        `${itemName}.serviceDate`
      ),
    }
  })
}

export function buildQuickBooksSalesLines(lines: QuickBooksSalesLineInput[]): unknown[] {
  const validated = parseQuickBooksSalesLines(lines)
  if (!validated) throw new Error('lines are required')
  return validated.map((line) => {
    if (line.lineType === 'description') {
      return { DetailType: 'DescriptionOnly', Description: line.description }
    }
    return filterUndefined({
      Amount: line.amount,
      Description: line.description,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: filterUndefined({
        ItemRef: quickBooksReference(line.itemId!, 'itemId'),
        Qty: line.quantity,
        UnitPrice: line.unitPrice,
        ServiceDate: line.serviceDate,
      }),
    })
  })
}

export function parseQuickBooksInvoiceAllocations(
  value: unknown,
  fieldName = 'invoiceAllocations'
): QuickBooksInvoiceAllocationInput[] | undefined {
  const parsed = parseJsonArray(value, fieldName)
  if (!parsed) return undefined
  if (parsed.length === 0) throw new Error(`${fieldName} must contain at least one allocation`)
  if (parsed.length > MAX_PAYMENT_ALLOCATIONS) {
    throw new Error(`${fieldName} cannot contain more than ${MAX_PAYMENT_ALLOCATIONS} allocations`)
  }
  return parsed.map((rawAllocation, index) => {
    const itemName = `${fieldName}[${index}]`
    const allocation = assertObject(rawAllocation, itemName)
    assertAllowedKeys(allocation, PAYMENT_ALLOCATION_KEYS, itemName)
    return {
      invoiceId: requiredStringValue(allocation.invoiceId, `${itemName}.invoiceId`),
      amount: requiredPositiveNumber(allocation.amount, `${itemName}.amount`),
    }
  })
}

function buildPaymentLines(
  allocations: QuickBooksInvoiceAllocationInput[] | undefined,
  totalAmount: number | undefined
): unknown[] | undefined {
  if (!allocations) return undefined
  if (totalAmount === undefined) {
    throw new Error('totalAmount is required when invoice allocations are supplied')
  }
  const allocationTotal = allocations.reduce(
    (sum, allocation) => sum.plus(allocation.amount),
    new Decimal(0)
  )
  if (allocationTotal.greaterThan(totalAmount)) {
    throw new Error('Invoice allocation amounts cannot exceed totalAmount')
  }
  return allocations.map((allocation) => ({
    Amount: allocation.amount,
    LinkedTxn: [{ TxnId: allocation.invoiceId, TxnType: 'Invoice' }],
  }))
}

export function buildQuickBooksCreateSalesDocumentBody(
  params: QuickBooksCreateSalesDocumentParams,
  options: { requireDepositAccount?: boolean } = {}
): Record<string, unknown> {
  if (options.requireDepositAccount && !params.depositAccountId?.trim()) {
    throw new Error('depositAccountId is required to create a refund receipt')
  }
  return filterUndefined({
    CustomerRef: quickBooksReference(params.customerId, 'customerId'),
    Line: buildQuickBooksSalesLines(params.lines),
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    DocNumber: optionalQuickBooksString(params.documentNumber),
    PrivateNote: optionalQuickBooksString(params.privateNote),
    CustomerMemo: optionalQuickBooksString(params.customerMemo)
      ? { value: optionalQuickBooksString(params.customerMemo) }
      : undefined,
    DueDate: validateQuickBooksDate(params.dueDate, 'dueDate'),
    ExpirationDate: validateQuickBooksDate(params.expirationDate, 'expirationDate'),
    PaymentMethodRef: params.paymentMethodId
      ? quickBooksReference(params.paymentMethodId, 'paymentMethodId')
      : undefined,
    PaymentRefNum: optionalQuickBooksString(params.paymentReferenceNumber),
    DepositToAccountRef: params.depositAccountId
      ? quickBooksReference(params.depositAccountId, 'depositAccountId')
      : undefined,
  })
}

export function buildQuickBooksUpdateSalesDocumentBody(
  params: QuickBooksUpdateSalesDocumentParams
): Record<string, unknown> {
  const body = filterUndefined({
    Id: requiredQuickBooksString(params.transactionId, 'transactionId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    CustomerRef: params.customerId
      ? quickBooksReference(params.customerId, 'customerId')
      : undefined,
    Line: params.lines ? buildQuickBooksSalesLines(params.lines) : undefined,
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    DocNumber: optionalQuickBooksString(params.documentNumber),
    PrivateNote: optionalQuickBooksString(params.privateNote),
    CustomerMemo: optionalQuickBooksString(params.customerMemo)
      ? { value: optionalQuickBooksString(params.customerMemo) }
      : undefined,
    DueDate: validateQuickBooksDate(params.dueDate, 'dueDate'),
    ExpirationDate: validateQuickBooksDate(params.expirationDate, 'expirationDate'),
    PaymentMethodRef: params.paymentMethodId
      ? quickBooksReference(params.paymentMethodId, 'paymentMethodId')
      : undefined,
    PaymentRefNum: optionalQuickBooksString(params.paymentReferenceNumber),
    DepositToAccountRef: params.depositAccountId
      ? quickBooksReference(params.depositAccountId, 'depositAccountId')
      : undefined,
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body)
  return body
}

export function buildQuickBooksCreatePaymentBody(
  params: QuickBooksCreateCustomerPaymentParams
): Record<string, unknown> {
  const totalAmount = requiredPositiveNumber(params.totalAmount, 'totalAmount')
  const allocations = parseQuickBooksInvoiceAllocations(params.invoiceAllocations)
  return filterUndefined({
    CustomerRef: quickBooksReference(params.customerId, 'customerId'),
    TotalAmt: totalAmount,
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    PrivateNote: optionalQuickBooksString(params.privateNote),
    PaymentRefNum: optionalQuickBooksString(params.paymentReferenceNumber),
    PaymentMethodRef: params.paymentMethodId
      ? quickBooksReference(params.paymentMethodId, 'paymentMethodId')
      : undefined,
    DepositToAccountRef: params.depositAccountId
      ? quickBooksReference(params.depositAccountId, 'depositAccountId')
      : undefined,
    Line: buildPaymentLines(allocations, totalAmount),
  })
}

export function buildQuickBooksUpdatePaymentBody(
  params: QuickBooksUpdateCustomerPaymentParams
): Record<string, unknown> {
  const totalAmount =
    params.totalAmount === undefined
      ? undefined
      : requiredPositiveNumber(params.totalAmount, 'totalAmount')
  const allocations = parseQuickBooksInvoiceAllocations(params.invoiceAllocations)
  const body = filterUndefined({
    Id: requiredQuickBooksString(params.paymentId, 'paymentId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    CustomerRef: params.customerId
      ? quickBooksReference(params.customerId, 'customerId')
      : undefined,
    TotalAmt: totalAmount,
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    PrivateNote: optionalQuickBooksString(params.privateNote),
    PaymentRefNum: optionalQuickBooksString(params.paymentReferenceNumber),
    PaymentMethodRef: params.paymentMethodId
      ? quickBooksReference(params.paymentMethodId, 'paymentMethodId')
      : undefined,
    DepositToAccountRef: params.depositAccountId
      ? quickBooksReference(params.depositAccountId, 'depositAccountId')
      : undefined,
    Line: buildPaymentLines(allocations, totalAmount),
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body)
  return body
}
