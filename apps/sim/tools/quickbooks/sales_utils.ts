import { filterUndefined } from '@sim/utils/object'
import Decimal from 'decimal.js'
import type {
  QuickBooksCreateCustomerPaymentParams,
  QuickBooksCreateSalesDocumentParams,
  QuickBooksInvoiceAllocationInput,
  QuickBooksSalesLineInput,
  QuickBooksSalesTransaction,
  QuickBooksTransactionLine,
  QuickBooksUpdateCustomerPaymentParams,
  QuickBooksUpdateSalesDocumentParams,
} from '@/tools/quickbooks/types'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  quickBooksReference,
  requiredQuickBooksString,
  validateQuickBooksDate,
} from '@/tools/quickbooks/values'

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

function quickBooksMoneyDecimal(value: unknown, fieldName: string, requirement: string): Decimal {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${fieldName} must be a ${requirement}`)
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') throw new Error(`${fieldName} must be a ${requirement}`)

  let decimal: Decimal
  try {
    decimal = new Decimal(normalized)
  } catch {
    throw new Error(`${fieldName} must be a ${requirement}`)
  }
  if (!decimal.isFinite()) throw new Error(`${fieldName} must be a ${requirement}`)
  if (decimal.decimalPlaces() > 2) {
    throw new Error(`${fieldName} cannot have more than two decimal places`)
  }

  const number = decimal.toNumber()
  if (
    !Number.isSafeInteger(decimal.times(100).toNumber()) ||
    !Number.isFinite(number) ||
    !new Decimal(number).equals(decimal)
  ) {
    throw new Error(`${fieldName} is outside the safely supported amount range`)
  }
  return decimal
}

function requiredPositiveNumber(value: unknown, fieldName: string): number {
  const decimal = quickBooksMoneyDecimal(value, fieldName, 'positive finite number')
  if (decimal.lte(0)) throw new Error(`${fieldName} must be a positive finite number`)
  return decimal.toNumber()
}

function optionalPositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${fieldName} must be a positive finite number`)
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') return undefined
  const parsed = typeof normalized === 'number' ? normalized : Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive finite number`)
  }
  return parsed
}

/**
 * Sales line monetary fields accept negative values: QuickBooks models
 * `Line.Amount` and `SalesItemLineDetail.UnitPrice` as unconstrained decimals,
 * and negative amounts are how discounts, returns and credits are expressed on
 * a sales form. Only a zero or non-finite value is rejected.
 */
function requiredNonZeroNumber(value: unknown, fieldName: string): number {
  const decimal = quickBooksMoneyDecimal(value, fieldName, 'non-zero finite number')
  if (decimal.isZero()) throw new Error(`${fieldName} must be a non-zero finite number`)
  return decimal.toNumber()
}

function optionalNonZeroNumber(value: unknown, fieldName: string): number | undefined {
  if (value == null || value === '') return undefined
  return requiredNonZeroNumber(value, fieldName)
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
    const amount = requiredNonZeroNumber(line.amount, `${itemName}.amount`)
    const quantity = optionalPositiveNumber(line.quantity, `${itemName}.quantity`)
    const unitPrice = optionalNonZeroNumber(line.unitPrice, `${itemName}.unitPrice`)
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
      return {
        DetailType: 'DescriptionOnly',
        Description: line.description,
        DescriptionLineDetail: {},
      }
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
  const invoiceIds = new Set<string>()
  return parsed.map((rawAllocation, index) => {
    const itemName = `${fieldName}[${index}]`
    const allocation = assertObject(rawAllocation, itemName)
    assertAllowedKeys(allocation, PAYMENT_ALLOCATION_KEYS, itemName)
    const invoiceId = requiredStringValue(allocation.invoiceId, `${itemName}.invoiceId`)
    if (invoiceIds.has(invoiceId)) {
      throw new Error(`${fieldName} lists invoice ${invoiceId} more than once`)
    }
    invoiceIds.add(invoiceId)
    return {
      invoiceId,
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

function getLinkedInvoiceId(line: QuickBooksTransactionLine): string | undefined {
  const linked = line.LinkedTxn?.find(
    (txn) => txn.TxnType === 'Invoice' && typeof txn.TxnId === 'string' && txn.TxnId.trim()
  )
  return linked?.TxnId?.trim()
}

function sumPaymentLineAmounts(lines: readonly QuickBooksTransactionLine[]): Decimal {
  return lines.reduce(
    (sum, line) => (typeof line.Amount === 'number' ? sum.plus(line.Amount) : sum),
    new Decimal(0)
  )
}

/**
 * Merge caller-supplied invoice allocations into the payment's current lines.
 *
 * QuickBooks requires an update to carry every `Line` the payment should keep —
 * lines are updated all-or-none — so sending only the caller's allocations
 * unapplies every other invoice on the payment. This preserves the existing
 * lines in their current order (the order QuickBooks preserves), overwrites the
 * `Amount` of each line whose linked invoice the caller named, and appends
 * allocations for invoices the payment is not applied to yet.
 */
export function mergeQuickBooksPaymentLines(
  existingLines: readonly QuickBooksTransactionLine[],
  allocations: readonly QuickBooksInvoiceAllocationInput[],
  effectiveTotalAmount: number | undefined
): QuickBooksTransactionLine[] {
  const requested = new Map<string, number>()
  for (const allocation of allocations) {
    if (requested.has(allocation.invoiceId)) {
      throw new Error(`invoiceAllocations lists invoice ${allocation.invoiceId} more than once`)
    }
    requested.set(allocation.invoiceId, allocation.amount)
  }

  const applied = new Set<string>()
  const merged = existingLines.map((line) => {
    const invoiceId = getLinkedInvoiceId(line)
    if (!invoiceId || !requested.has(invoiceId)) return line
    if (applied.has(invoiceId)) {
      throw new Error(
        `Payment has multiple lines linked to invoice ${invoiceId}; allocations cannot be merged unambiguously`
      )
    }
    applied.add(invoiceId)
    return { ...line, Amount: requested.get(invoiceId) }
  })

  for (const allocation of allocations) {
    if (applied.has(allocation.invoiceId)) continue
    merged.push({
      Amount: allocation.amount,
      LinkedTxn: [{ TxnId: allocation.invoiceId, TxnType: 'Invoice' }],
    })
  }

  if (effectiveTotalAmount === undefined) {
    throw new Error('totalAmount is required when invoice allocations are supplied')
  }
  if (sumPaymentLineAmounts(merged).greaterThan(effectiveTotalAmount)) {
    throw new Error('Invoice allocation amounts cannot exceed totalAmount')
  }
  return merged
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

function buildUpdatePaymentLines(
  params: QuickBooksUpdateCustomerPaymentParams,
  allocations: QuickBooksInvoiceAllocationInput[] | undefined,
  totalAmount: number | undefined,
  currentPayment: QuickBooksSalesTransaction | undefined
): unknown[] | undefined {
  if (params.unapplyOmittedInvoices && !allocations) {
    throw new Error('invoiceAllocations is required when unapplyOmittedInvoices is true')
  }
  const currentTotalAmount =
    typeof currentPayment?.TotalAmt === 'number' ? currentPayment.TotalAmt : undefined
  if (!allocations) {
    if (
      totalAmount !== undefined &&
      currentPayment &&
      sumPaymentLineAmounts(currentPayment.Line ?? []).greaterThan(totalAmount)
    ) {
      throw new Error('Existing invoice allocation amounts cannot exceed totalAmount')
    }
    return undefined
  }
  if (params.unapplyOmittedInvoices) {
    return buildPaymentLines(allocations, totalAmount ?? currentTotalAmount)
  }
  if (!currentPayment) {
    throw new Error(
      'The current payment must be read before invoice allocations can be updated. Set unapplyOmittedInvoices to replace every allocation instead.'
    )
  }
  return mergeQuickBooksPaymentLines(
    currentPayment.Line ?? [],
    allocations,
    totalAmount ?? currentTotalAmount
  )
}

/**
 * Build the Payment patch merged into the documented full-update request.
 *
 * `currentPayment` is the payment as QuickBooks currently holds it and is
 * required whenever invoice allocations are supplied: QuickBooks updates
 * payment lines all-or-none, so the allocations have to be merged into the
 * live line set before they can be sent. `unapplyOmittedInvoices` opts out of
 * the merge and replaces the line set outright, unapplying every invoice the
 * caller did not list.
 */
export function buildQuickBooksUpdatePaymentBody(
  params: QuickBooksUpdateCustomerPaymentParams,
  currentPayment?: QuickBooksSalesTransaction
): Record<string, unknown> {
  const totalAmount =
    params.totalAmount === undefined
      ? undefined
      : requiredPositiveNumber(params.totalAmount, 'totalAmount')
  const allocations = parseQuickBooksInvoiceAllocations(params.invoiceAllocations)
  const line = buildUpdatePaymentLines(params, allocations, totalAmount, currentPayment)
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
    Line: line,
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body)
  return body
}
