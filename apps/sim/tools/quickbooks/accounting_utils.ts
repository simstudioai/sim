import { filterUndefined } from '@sim/utils/object'
import Decimal from 'decimal.js'
import type {
  QuickBooksCreateDepositParams,
  QuickBooksCreateJournalEntryParams,
  QuickBooksDepositLineInput,
  QuickBooksJournalEntityType,
  QuickBooksJournalLineInput,
  QuickBooksJournalPostingType,
  QuickBooksUpdateDepositParams,
  QuickBooksUpdateJournalEntryParams,
} from '@/tools/quickbooks/types'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  quickBooksReference,
  requiredQuickBooksString,
  validateQuickBooksDate,
} from '@/tools/quickbooks/utils'

const MAX_ACCOUNTING_LINES = 100
const JOURNAL_LINE_KEYS = new Set([
  'postingType',
  'amount',
  'accountId',
  'description',
  'entityType',
  'entityId',
])
const DEPOSIT_LINE_KEYS = new Set(['amount', 'accountId', 'description'])

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

function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  fieldName: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key))
  if (unknownKey) throw new Error(`${fieldName} contains unsupported field "${unknownKey}"`)
}

function positiveNumber(value: unknown, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive finite number`)
  }
  return parsed
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string`)
  return requiredQuickBooksString(value, fieldName)
}

function optionalStringValue(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string`)
  return optionalQuickBooksString(value)
}

function validateLineCount(lines: unknown[], fieldName: string, minimum: number): void {
  if (lines.length < minimum) {
    throw new Error(
      `${fieldName} must contain at least ${minimum} ${minimum === 1 ? 'line' : 'lines'}`
    )
  }
  if (lines.length > MAX_ACCOUNTING_LINES) {
    throw new Error(`${fieldName} cannot contain more than ${MAX_ACCOUNTING_LINES} lines`)
  }
}

export function parseQuickBooksJournalLines(
  value: unknown,
  fieldName = 'lines'
): QuickBooksJournalLineInput[] | undefined {
  const parsed = parseJsonArray(value, fieldName)
  if (!parsed) return undefined
  validateLineCount(parsed, fieldName, 2)

  const lines = parsed.map((rawLine, index) => {
    const itemName = `${fieldName}[${index}]`
    const line = requireObject(rawLine, itemName)
    rejectUnknownKeys(line, JOURNAL_LINE_KEYS, itemName)
    if (line.postingType !== 'debit' && line.postingType !== 'credit') {
      throw new Error(`${itemName}.postingType must be debit or credit`)
    }
    const postingType = line.postingType as QuickBooksJournalPostingType
    const entityType = line.entityType as QuickBooksJournalEntityType | undefined
    if (
      entityType !== undefined &&
      entityType !== 'customer' &&
      entityType !== 'vendor' &&
      entityType !== 'employee'
    ) {
      throw new Error(`${itemName}.entityType must be customer, vendor, or employee`)
    }
    if ((entityType === undefined) !== (line.entityId === undefined)) {
      throw new Error(`${itemName}.entityType and entityId must be supplied together`)
    }
    return {
      postingType,
      amount: positiveNumber(line.amount, `${itemName}.amount`),
      accountId: stringValue(line.accountId, `${itemName}.accountId`),
      description: optionalStringValue(line.description, `${itemName}.description`),
      entityType,
      entityId:
        line.entityId === undefined
          ? undefined
          : stringValue(line.entityId, `${itemName}.entityId`),
    }
  })

  const debitTotal = lines
    .filter((line) => line.postingType === 'debit')
    .reduce((sum, line) => sum.plus(line.amount), new Decimal(0))
  const creditTotal = lines
    .filter((line) => line.postingType === 'credit')
    .reduce((sum, line) => sum.plus(line.amount), new Decimal(0))
  if (!debitTotal.equals(creditTotal)) {
    throw new Error('Journal entry debit and credit totals must balance')
  }
  return lines
}

export function buildQuickBooksJournalLines(lines: QuickBooksJournalLineInput[]): unknown[] {
  const validated = parseQuickBooksJournalLines(lines)
  if (!validated) throw new Error('lines are required')
  const entityTypes: Record<QuickBooksJournalEntityType, string> = {
    customer: 'Customer',
    employee: 'Employee',
    vendor: 'Vendor',
  }
  return validated.map((line) =>
    filterUndefined({
      Amount: line.amount,
      Description: line.description,
      DetailType: 'JournalEntryLineDetail',
      JournalEntryLineDetail: filterUndefined({
        PostingType: line.postingType === 'debit' ? 'Debit' : 'Credit',
        AccountRef: quickBooksReference(line.accountId, 'accountId'),
        Entity:
          line.entityType && line.entityId
            ? {
                Type: entityTypes[line.entityType],
                EntityRef: quickBooksReference(line.entityId, 'entityId'),
              }
            : undefined,
      }),
    })
  )
}

export function parseQuickBooksDepositLines(
  value: unknown,
  fieldName = 'lines'
): QuickBooksDepositLineInput[] | undefined {
  const parsed = parseJsonArray(value, fieldName)
  if (!parsed) return undefined
  validateLineCount(parsed, fieldName, 1)
  return parsed.map((rawLine, index) => {
    const itemName = `${fieldName}[${index}]`
    const line = requireObject(rawLine, itemName)
    rejectUnknownKeys(line, DEPOSIT_LINE_KEYS, itemName)
    return {
      amount: positiveNumber(line.amount, `${itemName}.amount`),
      accountId: stringValue(line.accountId, `${itemName}.accountId`),
      description: optionalStringValue(line.description, `${itemName}.description`),
    }
  })
}

export function buildQuickBooksDepositLines(lines: QuickBooksDepositLineInput[]): unknown[] {
  const validated = parseQuickBooksDepositLines(lines)
  if (!validated) throw new Error('lines are required')
  return validated.map((line) =>
    filterUndefined({
      Amount: line.amount,
      Description: line.description,
      DetailType: 'DepositLineDetail',
      DepositLineDetail: {
        AccountRef: quickBooksReference(line.accountId, 'accountId'),
      },
    })
  )
}

function transactionHeader(params: {
  transactionDate?: string
  documentNumber?: string
  privateNote?: string
}): Record<string, unknown> {
  return filterUndefined({
    TxnDate: validateQuickBooksDate(params.transactionDate, 'transactionDate'),
    DocNumber: optionalQuickBooksString(params.documentNumber),
    PrivateNote: optionalQuickBooksString(params.privateNote),
  })
}

function requirePostingConfirmation(confirmPosting: boolean): void {
  if (confirmPosting !== true) {
    throw new Error('Confirm posting must be yes before posting a journal entry')
  }
}

export function buildQuickBooksCreateJournalEntryBody(
  params: QuickBooksCreateJournalEntryParams
): Record<string, unknown> {
  requirePostingConfirmation(params.confirmPosting)
  return {
    ...transactionHeader(params),
    Line: buildQuickBooksJournalLines(params.lines),
  }
}

export function buildQuickBooksUpdateJournalEntryBody(
  params: QuickBooksUpdateJournalEntryParams
): Record<string, unknown> {
  requirePostingConfirmation(params.confirmPosting)
  const body = {
    Id: requiredQuickBooksString(params.journalEntryId, 'journalEntryId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    ...transactionHeader(params),
  }
  assertQuickBooksSparseUpdate(body)
  return body
}

export function buildQuickBooksCreateDepositBody(
  params: QuickBooksCreateDepositParams
): Record<string, unknown> {
  return {
    DepositToAccountRef: quickBooksReference(params.depositAccountId, 'depositAccountId'),
    ...transactionHeader(params),
    Line: buildQuickBooksDepositLines(params.lines),
  }
}

export function buildQuickBooksUpdateDepositBody(
  params: QuickBooksUpdateDepositParams
): Record<string, unknown> {
  const body = {
    Id: requiredQuickBooksString(params.depositId, 'depositId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    ...transactionHeader(params),
  }
  assertQuickBooksSparseUpdate(body)
  return body
}
