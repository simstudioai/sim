#!/usr/bin/env bun

/**
 * Empirical probe for whether the QuickBooks Online API honors `sparse: true` on the
 * ten entities whose developer-docs pages carry NO "Sparse update" section.
 *
 * DANGER — SANDBOX ONLY. This script CREATES and MUTATES real accounting records in
 * whatever company the supplied realm id points at. Running it against a production
 * QuickBooks company would write junk transactions into a customer's books and, if
 * `sparse` turns out to be ignored, would NULL writable fields on the records it
 * touches. It therefore hard-requires `QUICKBOOKS_ENV=sandbox`, additionally asserts
 * the resolved API host is the `sandbox-quickbooks.api.intuit.com` host, and refuses
 * to run otherwise. There is no override flag and none may be added.
 *
 * The question it settles: ten update tools in this PR send `sparse: true` to
 * CreditMemo, Payment, Bill, BillPayment, VendorCredit, Purchase, PurchaseOrder,
 * Vendor, Employee, and Item. Every one of those doc pages states the full-update
 * contract verbatim: "The request body must include all writable fields of the
 * existing object as returned in a read response. Writable fields omitted from the
 * request body are set to NULL." If the server honors `sparse` regardless, the
 * missing doc section is a docs-only nit. If it ignores `sparse`, those tools
 * silently destroy customer data.
 *
 * The evidence is genuinely mixed and this script deliberately does not prejudge it:
 *   - Purchase is CONFIRMED broken by an Intuit support thread reporting a
 *     structurally identical body returning SystemFault. That thread also says the
 *     same request "was working previously" — so behavior CHANGED and a passing
 *     probe today does not prove stability.
 *   - That same thread names Deposit, which DOES have a documented sparse section.
 *     The docs inventory therefore does not predict server behavior either way.
 *   - The Payment page's prose says a Payment "can be updated as a full update or a
 *     sparse update" while the page carries no sparse heading — absence of a section
 *     is sometimes only a docs gap.
 *
 * Purchase runs FIRST so the harness is validated against the known-bad case before
 * any other result is trusted. Deposit and Invoice run as controls: Deposit is
 * documented yet reported failing, Invoice is documented and expected to work.
 *
 * Per entity the probe: creates a record with several populated writable fields
 * (including a multi-line `Line` array where the entity supports one), reads it
 * back, POSTs `{Id, SyncToken, sparse: true, <one innocuous scalar>: "probe"}`,
 * reads it back again, and classifies the outcome as SPARSE_HONORED,
 * SPARSE_IGNORED_DATA_LOSS, SPARSE_REJECTED, or INCONCLUSIVE.
 *
 * Exits non-zero if any entity classifies as SPARSE_IGNORED_DATA_LOSS (the
 * ship-blocker) or if the run fails outright.
 *
 * Required environment:
 *   QUICKBOOKS_ENV=sandbox                (hard requirement)
 *   QUICKBOOKS_REALM_ID=<sandbox company id>
 * plus EITHER:
 *   QUICKBOOKS_ACCESS_TOKEN=<a fresh sandbox access token>
 * OR:
 *   QUICKBOOKS_REFRESH_TOKEN + QUICKBOOKS_CLIENT_ID + QUICKBOOKS_CLIENT_SECRET
 *
 * Usage:
 *   QUICKBOOKS_ENV=sandbox QUICKBOOKS_REALM_ID=... QUICKBOOKS_ACCESS_TOKEN=... \
 *     bun run apps/sim/scripts/quickbooks-sparse-probe.ts
 *
 * See QUICKBOOKS_SPARSE_PROBE.md at the repo root for how to obtain sandbox
 * credentials and how to act on each classification.
 */

import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import {
  buildQuickBooksCompanyUrl,
  buildQuickBooksHeaders,
  getQuickBooksApiBaseUrl,
  getQuickBooksEnvironment,
  normalizeQuickBooksRealmId,
} from '@/tools/quickbooks/client'

const SANDBOX_API_HOST = 'sandbox-quickbooks.api.intuit.com'
const OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const REQUEST_TIMEOUT_MS = 30_000

/** The literal written into the probe field. Its presence after the POST proves the write landed. */
const PROBE_VALUE = 'probe'

/**
 * Fields QuickBooks legitimately rewrites on every save. Differences here are never
 * evidence of sparse being ignored.
 */
const VOLATILE_FIELDS: ReadonlySet<string> = new Set([
  'SyncToken',
  'MetaData',
  'sparse',
  'domain',
  'time',
])

type Classification =
  | 'SPARSE_HONORED'
  | 'SPARSE_IGNORED_DATA_LOSS'
  | 'SPARSE_REJECTED'
  | 'INCONCLUSIVE'

type QboRecord = Record<string, unknown>

interface QboResponse {
  status: number
  ok: boolean
  rawBody: string
  json: QboRecord | null
}

interface CompanyRefs {
  bankAccountId: string
  expenseAccountId: string
  incomeAccountId: string
  apAccountId: string
  customerId: string
  vendorId: string
  itemId: string
}

interface CreatedRecord {
  entity: string
  resource: string
  id: string
  /** Transactions accept `?operation=delete`; name-list entities (Vendor/Employee/Item) do not. */
  deletable: boolean
}

interface ProbeSession {
  accessToken: string
  realmId: string
  created: CreatedRecord[]
}

interface EntitySpec {
  /** Wire entity name as it appears in the response envelope, e.g. `Purchase`. */
  entity: string
  /** Lowercase path segment, e.g. `purchase`. */
  resource: string
  /** Whether the entity's docs page carries a "Sparse update" section. */
  docsSparseSection: 'documented' | 'undocumented'
  /** One innocuous scalar writable field set to PROBE_VALUE by the sparse POST. */
  probeField: string
  deletable: boolean
  build: (session: ProbeSession, refs: CompanyRefs) => Promise<QboRecord>
}

interface EntityOutcome {
  entity: string
  docsSparseSection: 'documented' | 'undocumented'
  classification: Classification
  detail: string
}

function isRecord(value: unknown): value is QboRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: QboRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function requireString(record: QboRecord, key: string, context: string): string {
  const value = readString(record, key)
  if (!value) throw new Error(`${context} is missing a "${key}" string`)
  return value
}

function lineCount(record: QboRecord): number | null {
  const line = record.Line
  return Array.isArray(line) ? line.length : null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Refuses to proceed unless the resolved environment AND the resolved API host both
 * say sandbox. Two independent checks so a single mis-set variable cannot arm the
 * script against a live company.
 */
function assertSandboxOnly(): void {
  const environment = getQuickBooksEnvironment()
  if (environment !== 'sandbox') {
    throw new Error(
      `REFUSING TO RUN: QUICKBOOKS_ENV is "${environment}". This script creates and mutates real accounting records and may destroy writable fields. It runs against sandbox companies only. There is no override.`
    )
  }
  const host = new URL(getQuickBooksApiBaseUrl()).host
  if (host !== SANDBOX_API_HOST) {
    throw new Error(
      `REFUSING TO RUN: resolved QuickBooks API host is "${host}", expected "${SANDBOX_API_HOST}". There is no override.`
    )
  }
}

function requireEnvVars(): { realmId: string } {
  const missing: string[] = []
  if (!process.env.QUICKBOOKS_ENV) missing.push('QUICKBOOKS_ENV (must be "sandbox")')
  if (!process.env.QUICKBOOKS_REALM_ID) missing.push('QUICKBOOKS_REALM_ID')

  const hasAccessToken = Boolean(process.env.QUICKBOOKS_ACCESS_TOKEN)
  const hasRefreshFlow =
    Boolean(process.env.QUICKBOOKS_REFRESH_TOKEN) &&
    Boolean(process.env.QUICKBOOKS_CLIENT_ID) &&
    Boolean(process.env.QUICKBOOKS_CLIENT_SECRET)

  if (!hasAccessToken && !hasRefreshFlow) {
    missing.push(
      'QUICKBOOKS_ACCESS_TOKEN (or all three of QUICKBOOKS_REFRESH_TOKEN, QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET)'
    )
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables:\n  - ${missing.join('\n  - ')}`)
  }

  return { realmId: normalizeQuickBooksRealmId(process.env.QUICKBOOKS_REALM_ID as string) }
}

async function resolveAccessToken(): Promise<string> {
  const direct = process.env.QUICKBOOKS_ACCESS_TOKEN?.trim()
  if (direct) return direct

  const clientId = process.env.QUICKBOOKS_CLIENT_ID as string
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET as string
  const refreshToken = process.env.QUICKBOOKS_REFRESH_TOKEN as string

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const rawBody = await response.text()
  if (!response.ok) {
    throw new Error(`QuickBooks token refresh failed with HTTP ${response.status}: ${rawBody}`)
  }

  const parsed: unknown = JSON.parse(rawBody)
  if (!isRecord(parsed)) throw new Error('QuickBooks token refresh returned a non-object body')
  const accessToken = readString(parsed, 'access_token')
  if (!accessToken) throw new Error('QuickBooks token refresh response has no access_token')
  return accessToken
}

async function qboRequest(
  session: ProbeSession,
  resource: string,
  init: { method: 'GET' | 'POST'; body?: QboRecord; query?: Record<string, string> }
): Promise<QboResponse> {
  const url = buildQuickBooksCompanyUrl(session.realmId, resource)
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)

  const headers: Record<string, string> = buildQuickBooksHeaders(session.accessToken)
  if (init.body) headers['Content-Type'] = 'application/json'

  const response = await fetch(url, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const rawBody = await response.text()
  let json: QboRecord | null = null
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (isRecord(parsed)) json = parsed
  } catch {
    json = null
  }

  return { status: response.status, ok: response.ok, rawBody, json }
}

function extractEntity(response: QboResponse, entity: string): QboRecord {
  const payload = response.json?.[entity]
  if (!isRecord(payload)) {
    throw new Error(
      `QuickBooks response did not contain a "${entity}" object (HTTP ${response.status}): ${response.rawBody}`
    )
  }
  return payload
}

async function queryFirstId(
  session: ProbeSession,
  statement: string,
  entity: string
): Promise<string> {
  const response = await qboRequest(session, 'query', {
    method: 'GET',
    query: { query: statement },
  })
  if (!response.ok) {
    throw new Error(
      `QuickBooks query failed (HTTP ${response.status}) for "${statement}": ${response.rawBody}`
    )
  }
  const queryResponse = response.json?.QueryResponse
  const rows = isRecord(queryResponse) ? queryResponse[entity] : undefined
  if (!Array.isArray(rows) || rows.length === 0 || !isRecord(rows[0])) {
    throw new Error(
      `QuickBooks sandbox has no ${entity} matching "${statement}". Seed the sandbox company before probing.`
    )
  }
  return requireString(rows[0], 'Id', `${entity} query result`)
}

async function resolveCompanyRefs(session: ProbeSession): Promise<CompanyRefs> {
  const [
    bankAccountId,
    expenseAccountId,
    incomeAccountId,
    apAccountId,
    customerId,
    vendorId,
    itemId,
  ] = await Promise.all([
    queryFirstId(
      session,
      "select Id from Account where AccountType = 'Bank' maxresults 1",
      'Account'
    ),
    queryFirstId(
      session,
      "select Id from Account where AccountType = 'Expense' maxresults 1",
      'Account'
    ),
    queryFirstId(
      session,
      "select Id from Account where AccountType = 'Income' maxresults 1",
      'Account'
    ),
    queryFirstId(
      session,
      "select Id from Account where AccountType = 'Accounts Payable' maxresults 1",
      'Account'
    ),
    queryFirstId(session, 'select Id from Customer maxresults 1', 'Customer'),
    queryFirstId(session, 'select Id from Vendor maxresults 1', 'Vendor'),
    queryFirstId(session, "select Id from Item where Type = 'Service' maxresults 1", 'Item'),
  ])

  return {
    bankAccountId,
    expenseAccountId,
    incomeAccountId,
    apAccountId,
    customerId,
    vendorId,
    itemId,
  }
}

/** Creates a record and registers it for cleanup. Returns the created entity payload. */
async function createRecord(
  session: ProbeSession,
  entity: string,
  resource: string,
  body: QboRecord,
  deletable: boolean
): Promise<QboRecord> {
  const response = await qboRequest(session, resource, { method: 'POST', body })
  if (!response.ok) {
    throw new Error(`Failed to create ${entity} (HTTP ${response.status}): ${response.rawBody}`)
  }
  const created = extractEntity(response, entity)
  const id = requireString(created, 'Id', `created ${entity}`)
  session.created.push({ entity, resource, id, deletable })
  return created
}

async function readRecord(
  session: ProbeSession,
  entity: string,
  resource: string,
  id: string
): Promise<QboRecord> {
  const response = await qboRequest(session, `${resource}/${encodeURIComponent(id)}`, {
    method: 'GET',
  })
  if (!response.ok) {
    throw new Error(`Failed to read ${entity} ${id} (HTTP ${response.status}): ${response.rawBody}`)
  }
  return extractEntity(response, entity)
}

function accountExpenseLine(amount: number, accountId: string, description: string): QboRecord {
  return {
    Amount: amount,
    DetailType: 'AccountBasedExpenseLineDetail',
    Description: description,
    AccountBasedExpenseLineDetail: { AccountRef: { value: accountId } },
  }
}

function salesItemLine(amount: number, itemId: string, description: string): QboRecord {
  return {
    Amount: amount,
    DetailType: 'SalesItemLineDetail',
    Description: description,
    SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: amount },
  }
}

function probeTag(): string {
  return `sim-sparse-probe-${generateShortId(8)}`
}

const ENTITY_SPECS: readonly EntitySpec[] = [
  {
    entity: 'Purchase',
    resource: 'purchase',
    docsSparseSection: 'undocumented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'Purchase',
        'purchase',
        {
          PaymentType: 'Cash',
          AccountRef: { value: refs.bankAccountId },
          EntityRef: { value: refs.vendorId, type: 'Vendor' },
          TxnDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: probeTag(),
          Line: [
            accountExpenseLine(11.11, refs.expenseAccountId, 'probe line one'),
            accountExpenseLine(22.22, refs.expenseAccountId, 'probe line two'),
          ],
        },
        true
      ),
  },
  {
    entity: 'Deposit',
    resource: 'deposit',
    docsSparseSection: 'documented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'Deposit',
        'deposit',
        {
          DepositToAccountRef: { value: refs.bankAccountId },
          TxnDate: today(),
          PrivateNote: probeTag(),
          Line: [
            {
              Amount: 33.33,
              DetailType: 'DepositLineDetail',
              Description: 'probe line one',
              DepositLineDetail: { AccountRef: { value: refs.incomeAccountId } },
            },
            {
              Amount: 44.44,
              DetailType: 'DepositLineDetail',
              Description: 'probe line two',
              DepositLineDetail: { AccountRef: { value: refs.incomeAccountId } },
            },
          ],
        },
        true
      ),
  },
  {
    entity: 'Invoice',
    resource: 'invoice',
    docsSparseSection: 'documented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'Invoice',
        'invoice',
        {
          CustomerRef: { value: refs.customerId },
          TxnDate: today(),
          DueDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: probeTag(),
          CustomerMemo: { value: 'probe memo' },
          Line: [
            salesItemLine(55.55, refs.itemId, 'probe line one'),
            salesItemLine(66.66, refs.itemId, 'probe line two'),
          ],
        },
        true
      ),
  },
  {
    entity: 'CreditMemo',
    resource: 'creditmemo',
    docsSparseSection: 'undocumented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'CreditMemo',
        'creditmemo',
        {
          CustomerRef: { value: refs.customerId },
          TxnDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: probeTag(),
          CustomerMemo: { value: 'probe memo' },
          Line: [
            salesItemLine(12.34, refs.itemId, 'probe line one'),
            salesItemLine(23.45, refs.itemId, 'probe line two'),
          ],
        },
        true
      ),
  },
  {
    entity: 'Payment',
    resource: 'payment',
    docsSparseSection: 'undocumented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'Payment',
        'payment',
        {
          CustomerRef: { value: refs.customerId },
          TotalAmt: 77.77,
          TxnDate: today(),
          PaymentRefNum: generateShortId(8),
          PrivateNote: probeTag(),
          DepositToAccountRef: { value: refs.bankAccountId },
        },
        true
      ),
  },
  {
    entity: 'Bill',
    resource: 'bill',
    docsSparseSection: 'undocumented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'Bill',
        'bill',
        {
          VendorRef: { value: refs.vendorId },
          APAccountRef: { value: refs.apAccountId },
          TxnDate: today(),
          DueDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: probeTag(),
          Line: [
            accountExpenseLine(31.31, refs.expenseAccountId, 'probe line one'),
            accountExpenseLine(41.41, refs.expenseAccountId, 'probe line two'),
          ],
        },
        true
      ),
  },
  {
    entity: 'BillPayment',
    resource: 'billpayment',
    docsSparseSection: 'undocumented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) => {
      const bill = await createRecord(
        session,
        'Bill',
        'bill',
        {
          VendorRef: { value: refs.vendorId },
          APAccountRef: { value: refs.apAccountId },
          TxnDate: today(),
          DueDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: `${probeTag()}-billpayment-prereq`,
          Line: [accountExpenseLine(50, refs.expenseAccountId, 'billpayment prerequisite')],
        },
        true
      )
      const billId = requireString(bill, 'Id', 'BillPayment prerequisite Bill')

      return createRecord(
        session,
        'BillPayment',
        'billpayment',
        {
          VendorRef: { value: refs.vendorId },
          PayType: 'Check',
          CheckPayment: { BankAccountRef: { value: refs.bankAccountId } },
          TotalAmt: 50,
          TxnDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: probeTag(),
          Line: [{ Amount: 50, LinkedTxn: [{ TxnId: billId, TxnType: 'Bill' }] }],
        },
        true
      )
    },
  },
  {
    entity: 'VendorCredit',
    resource: 'vendorcredit',
    docsSparseSection: 'undocumented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'VendorCredit',
        'vendorcredit',
        {
          VendorRef: { value: refs.vendorId },
          APAccountRef: { value: refs.apAccountId },
          TxnDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: probeTag(),
          Line: [
            accountExpenseLine(13.13, refs.expenseAccountId, 'probe line one'),
            accountExpenseLine(14.14, refs.expenseAccountId, 'probe line two'),
          ],
        },
        true
      ),
  },
  {
    entity: 'PurchaseOrder',
    resource: 'purchaseorder',
    docsSparseSection: 'undocumented',
    probeField: 'PrivateNote',
    deletable: true,
    build: async (session, refs) =>
      createRecord(
        session,
        'PurchaseOrder',
        'purchaseorder',
        {
          VendorRef: { value: refs.vendorId },
          APAccountRef: { value: refs.apAccountId },
          TxnDate: today(),
          DocNumber: generateShortId(8),
          PrivateNote: probeTag(),
          Memo: 'probe memo',
          Line: [
            {
              Amount: 15.15,
              DetailType: 'ItemBasedExpenseLineDetail',
              Description: 'probe line one',
              ItemBasedExpenseLineDetail: {
                ItemRef: { value: refs.itemId },
                Qty: 1,
                UnitPrice: 15.15,
              },
            },
            {
              Amount: 16.16,
              DetailType: 'ItemBasedExpenseLineDetail',
              Description: 'probe line two',
              ItemBasedExpenseLineDetail: {
                ItemRef: { value: refs.itemId },
                Qty: 1,
                UnitPrice: 16.16,
              },
            },
          ],
        },
        true
      ),
  },
  {
    entity: 'Vendor',
    resource: 'vendor',
    docsSparseSection: 'undocumented',
    probeField: 'PrintOnCheckName',
    deletable: false,
    build: async (session) => {
      const suffix = generateShortId(8)
      return createRecord(
        session,
        'Vendor',
        'vendor',
        {
          DisplayName: `Sim Sparse Probe Vendor ${suffix}`,
          CompanyName: `Sim Sparse Probe Co ${suffix}`,
          PrintOnCheckName: `Sim Sparse Probe Check ${suffix}`,
          GivenName: 'Sparse',
          FamilyName: 'Probe',
          PrimaryEmailAddr: { Address: `sparse-probe-${suffix}@example.com` },
          PrimaryPhone: { FreeFormNumber: '555-0100' },
          BillAddr: {
            Line1: '1 Probe Street',
            City: 'Mountain View',
            CountrySubDivisionCode: 'CA',
            PostalCode: '94043',
          },
        },
        false
      )
    },
  },
  {
    entity: 'Employee',
    resource: 'employee',
    docsSparseSection: 'undocumented',
    probeField: 'PrintOnCheckName',
    deletable: false,
    build: async (session) => {
      const suffix = generateShortId(8)
      return createRecord(
        session,
        'Employee',
        'employee',
        {
          GivenName: 'Sparse',
          FamilyName: `Probe${suffix}`,
          DisplayName: `Sparse Probe ${suffix}`,
          PrintOnCheckName: `Sparse Probe Check ${suffix}`,
          PrimaryPhone: { FreeFormNumber: '555-0101' },
          PrimaryAddr: {
            Line1: '2 Probe Street',
            City: 'Mountain View',
            CountrySubDivisionCode: 'CA',
            PostalCode: '94043',
          },
        },
        false
      )
    },
  },
  {
    entity: 'Item',
    resource: 'item',
    docsSparseSection: 'undocumented',
    probeField: 'Description',
    deletable: false,
    build: async (session, refs) => {
      const suffix = generateShortId(8)
      return createRecord(
        session,
        'Item',
        'item',
        {
          Name: `Sim Sparse Probe Item ${suffix}`,
          Type: 'Service',
          Description: `probe description ${suffix}`,
          UnitPrice: 19.99,
          Taxable: false,
          IncomeAccountRef: { value: refs.incomeAccountId },
        },
        false
      )
    },
  },
]

interface Comparison {
  droppedFields: string[]
  changedFields: string[]
  lineCountBefore: number | null
  lineCountAfter: number | null
}

/**
 * A sparse update must change exactly the probe field. Dropped fields (present before,
 * gone or null after) and a shrunken `Line` array are the data-loss signature. Fields
 * that merely changed value are reported but not treated as proof, because QuickBooks
 * recomputes some derived amounts on every save.
 */
function compareRecords(before: QboRecord, after: QboRecord, probeField: string): Comparison {
  const droppedFields: string[] = []
  const changedFields: string[] = []

  for (const [key, beforeValue] of Object.entries(before)) {
    if (VOLATILE_FIELDS.has(key) || key === probeField) continue
    const afterValue = after[key]
    if (afterValue === undefined || afterValue === null) {
      droppedFields.push(key)
      continue
    }
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) changedFields.push(key)
  }

  return {
    droppedFields,
    changedFields,
    lineCountBefore: lineCount(before),
    lineCountAfter: lineCount(after),
  }
}

function classify(
  spec: EntitySpec,
  sparseResponse: QboResponse,
  before: QboRecord,
  after: QboRecord | null
): EntityOutcome {
  const base = { entity: spec.entity, docsSparseSection: spec.docsSparseSection }

  if (!sparseResponse.ok) {
    const isRejection = sparseResponse.status >= 400 && sparseResponse.status < 600
    if (isRejection) {
      return {
        ...base,
        classification: 'SPARSE_REJECTED',
        detail: `HTTP ${sparseResponse.status}: ${sparseResponse.rawBody}`,
      }
    }
    return {
      ...base,
      classification: 'INCONCLUSIVE',
      detail: `Unexpected HTTP ${sparseResponse.status}: ${sparseResponse.rawBody}`,
    }
  }

  if (!after) {
    return {
      ...base,
      classification: 'INCONCLUSIVE',
      detail: `Sparse POST returned HTTP 200 but the record could not be re-read. Raw response: ${sparseResponse.rawBody}`,
    }
  }

  const comparison = compareRecords(before, after, spec.probeField)
  const linesLost =
    comparison.lineCountBefore !== null &&
    comparison.lineCountAfter !== null &&
    comparison.lineCountAfter < comparison.lineCountBefore

  if (comparison.droppedFields.length > 0 || linesLost) {
    return {
      ...base,
      classification: 'SPARSE_IGNORED_DATA_LOSS',
      detail: [
        comparison.droppedFields.length > 0
          ? `nulled/dropped fields: ${comparison.droppedFields.join(', ')}`
          : null,
        linesLost
          ? `Line array shrank ${comparison.lineCountBefore} -> ${comparison.lineCountAfter}`
          : null,
      ]
        .filter(Boolean)
        .join('; '),
    }
  }

  const probeApplied = after[spec.probeField] === PROBE_VALUE
  if (!probeApplied) {
    return {
      ...base,
      classification: 'INCONCLUSIVE',
      detail: `HTTP 200 and no data loss, but ${spec.probeField} is ${JSON.stringify(after[spec.probeField])} rather than "${PROBE_VALUE}". Raw response: ${sparseResponse.rawBody}`,
    }
  }

  if (comparison.changedFields.length > 0) {
    return {
      ...base,
      classification: 'INCONCLUSIVE',
      detail: `Probe field applied and nothing dropped, but these fields changed value: ${comparison.changedFields.join(', ')}. Raw response: ${sparseResponse.rawBody}`,
    }
  }

  return {
    ...base,
    classification: 'SPARSE_HONORED',
    detail: `${spec.probeField} updated; ${comparison.lineCountAfter ?? 0} Line entries and all other writable fields intact`,
  }
}

async function probeEntity(
  session: ProbeSession,
  spec: EntitySpec,
  refs: CompanyRefs
): Promise<EntityOutcome> {
  console.log(`\n--- ${spec.entity} (${spec.docsSparseSection}) ---`)

  const created = await spec.build(session, refs)
  const id = requireString(created, 'Id', `created ${spec.entity}`)

  const before = await readRecord(session, spec.entity, spec.resource, id)
  const syncToken = requireString(before, 'SyncToken', `${spec.entity} ${id}`)
  console.log(
    `created ${spec.entity} Id=${id} SyncToken=${syncToken} lines=${lineCount(before) ?? 'n/a'}`
  )
  console.log(`payload before probe: ${JSON.stringify(before)}`)

  const sparseResponse = await qboRequest(session, spec.resource, {
    method: 'POST',
    body: { Id: id, SyncToken: syncToken, sparse: true, [spec.probeField]: PROBE_VALUE },
  })
  console.log(`sparse POST -> HTTP ${sparseResponse.status}`)

  let after: QboRecord | null = null
  if (sparseResponse.ok) {
    after = await readRecord(session, spec.entity, spec.resource, id)
    console.log(`payload after probe: ${JSON.stringify(after)}`)
  }

  const outcome = classify(spec, sparseResponse, before, after)
  console.log(`=> ${outcome.classification}: ${outcome.detail}`)
  return outcome
}

async function cleanup(session: ProbeSession): Promise<void> {
  console.log('\n--- cleanup ---')
  const undeleted: CreatedRecord[] = []

  for (const record of [...session.created].reverse()) {
    if (!record.deletable) {
      undeleted.push(record)
      continue
    }
    try {
      const current = await readRecord(session, record.entity, record.resource, record.id)
      const syncToken = requireString(current, 'SyncToken', `${record.entity} ${record.id}`)
      const response = await qboRequest(session, record.resource, {
        method: 'POST',
        query: { operation: 'delete' },
        body: { Id: record.id, SyncToken: syncToken },
      })
      if (response.ok) {
        console.log(`deleted ${record.entity} ${record.id}`)
      } else {
        console.error(
          `FAILED to delete ${record.entity} ${record.id} (HTTP ${response.status}): ${response.rawBody}`
        )
        undeleted.push(record)
      }
    } catch (error) {
      console.error(`FAILED to delete ${record.entity} ${record.id}: ${getErrorMessage(error)}`)
      undeleted.push(record)
    }
  }

  if (undeleted.length > 0) {
    console.error(
      '\nMANUAL CLEANUP REQUIRED — the following sandbox records were left behind (QuickBooks does not delete name-list entities; deactivate them by hand):'
    )
    for (const record of undeleted) {
      console.error(`  - ${record.entity} Id=${record.id}`)
    }
  }
}

function printSummary(outcomes: readonly EntityOutcome[]): void {
  console.log('\n=== SUMMARY ===')
  const entityWidth = Math.max(...outcomes.map((outcome) => outcome.entity.length), 'Entity'.length)
  const header = `${'Entity'.padEnd(entityWidth)}  ${'Docs'.padEnd(12)}  Classification`
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const outcome of outcomes) {
    console.log(
      `${outcome.entity.padEnd(entityWidth)}  ${outcome.docsSparseSection.padEnd(12)}  ${outcome.classification}`
    )
  }
}

async function main(): Promise<void> {
  const { realmId } = requireEnvVars()
  assertSandboxOnly()

  console.log(`QuickBooks sparse probe — sandbox realm ${realmId} @ ${getQuickBooksApiBaseUrl()}`)

  const session: ProbeSession = {
    accessToken: await resolveAccessToken(),
    realmId,
    created: [],
  }

  const outcomes: EntityOutcome[] = []
  let runError: unknown = null

  try {
    const refs = await resolveCompanyRefs(session)
    console.log(`resolved company refs: ${JSON.stringify(refs)}`)

    for (const spec of ENTITY_SPECS) {
      try {
        outcomes.push(await probeEntity(session, spec, refs))
      } catch (error) {
        const detail = getErrorMessage(error)
        console.error(`${spec.entity} probe failed: ${detail}`)
        outcomes.push({
          entity: spec.entity,
          docsSparseSection: spec.docsSparseSection,
          classification: 'INCONCLUSIVE',
          detail,
        })
      }
    }
  } catch (error) {
    runError = error
    console.error(`Probe run aborted: ${getErrorMessage(error)}`)
  } finally {
    await cleanup(session)
  }

  if (outcomes.length > 0) printSummary(outcomes)

  console.log('\n=== DETAIL ===')
  for (const outcome of outcomes) {
    console.log(`${outcome.entity}: ${outcome.classification} — ${outcome.detail}`)
  }

  const dataLoss = outcomes.filter(
    (outcome) => outcome.classification === 'SPARSE_IGNORED_DATA_LOSS'
  )
  if (dataLoss.length > 0) {
    console.error(
      `\nSHIP-BLOCKER: ${dataLoss.length} entit${dataLoss.length === 1 ? 'y' : 'ies'} silently lost data under sparse: ${dataLoss.map((outcome) => outcome.entity).join(', ')}`
    )
    process.exit(1)
  }
  if (runError) process.exit(1)
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error))
  process.exit(1)
})
