import { filterUndefined } from '@sim/utils/object'
import Decimal from 'decimal.js'
import type {
  QuickBooksBillAllocationInput,
  QuickBooksBillLineInput,
  QuickBooksBillLinkInput,
  QuickBooksCreateBillParams,
  QuickBooksCreateBillPaymentParams,
  QuickBooksCreatePurchaseOrderParams,
  QuickBooksCreatePurchaseParams,
  QuickBooksCreateVendorCreditParams,
  QuickBooksLinkedBillLine,
  QuickBooksPurchasingLineInput,
  QuickBooksPurchasingTransaction,
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
const BILL_LINK_KEYS = ['purchaseOrderId', 'purchaseOrderLineId'] as const
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

function parseQuickBooksPurchasingLinesInternal(
  value: unknown,
  fieldName: string,
  allowBillLinks: boolean
): QuickBooksBillLineInput[] | undefined {
  const parsed = parseJsonArray(value, fieldName)
  if (!parsed) return undefined
  if (parsed.length === 0) throw new Error(`${fieldName} must contain at least one line`)
  if (parsed.length > MAX_PURCHASING_LINES) {
    throw new Error(`${fieldName} cannot contain more than ${MAX_PURCHASING_LINES} lines`)
  }

  const linkedPairs = new Set<string>()
  return parsed.map((rawLine, index) => {
    const itemName = `${fieldName}[${index}]`
    const line = assertObject(rawLine, itemName)
    const allowedKeys =
      line.lineType === 'account' ? new Set(ACCOUNT_LINE_KEYS) : new Set(ITEM_LINE_KEYS)
    if (allowBillLinks) {
      for (const key of BILL_LINK_KEYS) allowedKeys.add(key)
    }

    let parsedLine: QuickBooksBillLineInput
    if (line.lineType === 'account') {
      assertAllowedKeys(line, allowedKeys, itemName)
      parsedLine = {
        lineType: 'account',
        amount: requiredPositiveNumber(line.amount, `${itemName}.amount`),
        accountId: requiredStringValue(line.accountId, `${itemName}.accountId`),
        description: optionalStringValue(line.description, `${itemName}.description`),
      }
    } else if (line.lineType === 'item') {
      assertAllowedKeys(line, allowedKeys, itemName)
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
      parsedLine = {
        lineType: 'item',
        amount,
        itemId: requiredStringValue(line.itemId, `${itemName}.itemId`),
        description: optionalStringValue(line.description, `${itemName}.description`),
        quantity,
        unitPrice,
      }
    } else {
      throw new Error(`${itemName}.lineType must be account or item`)
    }

    if (allowBillLinks) {
      const hasPurchaseOrderId = Object.hasOwn(line, 'purchaseOrderId')
      const hasPurchaseOrderLineId = Object.hasOwn(line, 'purchaseOrderLineId')
      if (hasPurchaseOrderId !== hasPurchaseOrderLineId) {
        throw new Error(
          `${itemName}.purchaseOrderId and ${itemName}.purchaseOrderLineId must be supplied together`
        )
      }
      if (hasPurchaseOrderId) {
        const purchaseOrderId = requiredStringValue(
          line.purchaseOrderId,
          `${itemName}.purchaseOrderId`
        )
        const purchaseOrderLineId = requiredStringValue(
          line.purchaseOrderLineId,
          `${itemName}.purchaseOrderLineId`
        )
        const pairKey = `${purchaseOrderId}\0${purchaseOrderLineId}`
        if (linkedPairs.has(pairKey)) {
          throw new Error(
            `${fieldName} contains duplicate Purchase Order line link "${purchaseOrderId}:${purchaseOrderLineId}"`
          )
        }
        linkedPairs.add(pairKey)
        parsedLine.purchaseOrderId = purchaseOrderId
        parsedLine.purchaseOrderLineId = purchaseOrderLineId
      }
    }

    return parsedLine
  })
}

export function parseQuickBooksPurchasingLines(
  value: unknown,
  fieldName = 'lines'
): QuickBooksPurchasingLineInput[] | undefined {
  return parseQuickBooksPurchasingLinesInternal(value, fieldName, false)
}

export function parseQuickBooksBillLines(
  value: unknown,
  fieldName = 'lines'
): QuickBooksBillLineInput[] | undefined {
  return parseQuickBooksPurchasingLinesInternal(value, fieldName, true)
}

function buildQuickBooksPurchasingLine(
  line: QuickBooksPurchasingLineInput
): Record<string, unknown> {
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
}

function buildValidatedQuickBooksBillLines(lines: QuickBooksBillLineInput[]): unknown[] {
  return lines.map((line) => ({
    ...buildQuickBooksPurchasingLine(line),
    ...(line.purchaseOrderId && line.purchaseOrderLineId
      ? {
          LinkedTxn: [
            {
              TxnId: line.purchaseOrderId,
              TxnType: 'PurchaseOrder',
              TxnLineId: line.purchaseOrderLineId,
            },
          ],
        }
      : {}),
  }))
}

export function buildQuickBooksPurchasingLines(lines: QuickBooksPurchasingLineInput[]): unknown[] {
  const validated = parseQuickBooksPurchasingLines(lines)
  if (!validated) throw new Error('lines are required')
  return validated.map(buildQuickBooksPurchasingLine)
}

export function buildQuickBooksBillLines(lines: QuickBooksBillLineInput[]): unknown[] {
  const validated = parseQuickBooksBillLines(lines)
  if (!validated) throw new Error('lines are required')
  return buildValidatedQuickBooksBillLines(validated)
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
  const lines = parseQuickBooksBillLines(params.lines)
  if (!lines) throw new Error('lines are required')
  const purchaseOrderIds = [
    ...new Set(lines.flatMap((line) => (line.purchaseOrderId ? [line.purchaseOrderId] : []))),
  ]
  return {
    ...purchasingHeader(params),
    VendorRef: quickBooksReference(params.vendorId, 'vendorId'),
    Line: buildValidatedQuickBooksBillLines(lines),
    ...(purchaseOrderIds.length > 0
      ? {
          LinkedTxn: purchaseOrderIds.map((TxnId) => ({
            TxnId,
            TxnType: 'PurchaseOrder',
          })),
        }
      : {}),
  }
}

export function verifyQuickBooksBillLinks(
  record: QuickBooksPurchasingTransaction,
  lines: QuickBooksBillLineInput[],
  recordId: string
): {
  linkingRequested: boolean
  linkingSucceeded: boolean | null
  linkedLines: QuickBooksLinkedBillLine[]
  missingLinks: QuickBooksBillLinkInput[]
  linkingWarning?: string
} {
  const validated = parseQuickBooksBillLines(lines)
  if (!validated) throw new Error('lines are required')
  const requested = validated.flatMap((line) =>
    line.purchaseOrderId && line.purchaseOrderLineId
      ? [
          {
            purchaseOrderId: line.purchaseOrderId,
            purchaseOrderLineId: line.purchaseOrderLineId,
          },
        ]
      : []
  )
  if (requested.length === 0) {
    return {
      linkingRequested: false,
      linkingSucceeded: null,
      linkedLines: [],
      missingLinks: [],
    }
  }

  const returnedLinks = new Map<string, string | undefined>()
  for (const billLine of record.Line ?? []) {
    for (const link of billLine.LinkedTxn ?? []) {
      if (link.TxnType?.trim() !== 'PurchaseOrder') continue
      const purchaseOrderId = link.TxnId?.trim()
      const purchaseOrderLineId = link.TxnLineId?.trim()
      if (!purchaseOrderId || !purchaseOrderLineId) continue
      const billLineId =
        typeof billLine.Id === 'string' ? billLine.Id.trim() || undefined : undefined
      returnedLinks.set(`${purchaseOrderId}\0${purchaseOrderLineId}`, billLineId)
    }
  }

  const linkedLines: QuickBooksLinkedBillLine[] = []
  const missingLinks: QuickBooksBillLinkInput[] = []
  for (const requestedLink of requested) {
    const key = `${requestedLink.purchaseOrderId}\0${requestedLink.purchaseOrderLineId}`
    if (returnedLinks.has(key)) {
      linkedLines.push({
        ...requestedLink,
        billLineId: returnedLinks.get(key),
      })
    } else {
      missingLinks.push(requestedLink)
    }
  }

  const linkingSucceeded = missingLinks.length === 0
  return {
    linkingRequested: true,
    linkingSucceeded,
    linkedLines,
    missingLinks,
    ...(linkingSucceeded
      ? {}
      : {
          linkingWarning: `QuickBooks created Bill ${recordId}, but did not establish ${missingLinks.length} requested Purchase Order line link(s). Review missingLinks before continuing.`,
        }),
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
