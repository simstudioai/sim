/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBackoff, mockSecureFetch, mockSleep, mockValidateUrl } = vi.hoisted(() => ({
  mockBackoff: vi.fn(() => 0),
  mockSecureFetch: vi.fn(),
  mockSleep: vi.fn(async () => undefined),
  mockValidateUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))
vi.mock('@sim/utils/helpers', () => ({ interruptibleSleep: mockSleep }))
vi.mock('@sim/utils/retry', () => ({
  backoffWithJitter: mockBackoff,
  parseRetryAfter: vi.fn((value: string | null) => (value === '2' ? 2_000 : null)),
}))

import {
  OracleFusionFinancialsProviderError,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion-financials/client'
import { executeOracleFusionFinancialsTool } from '@/lib/internal/oracle-fusion-financials/execute-tool'
import {
  executeOracleFusionFinancialsOperation,
  type OracleFusionFinancialsToolId,
} from '@/lib/internal/oracle-fusion-financials/operations'
import {
  ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
  ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
  ORACLE_FUSION_INSTALLMENT_FIELDS,
  ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
  ORACLE_FUSION_INVOICE_FIELDS,
  ORACLE_FUSION_INVOICE_HOLD_FIELDS,
  ORACLE_FUSION_INVOICE_LINE_FIELDS,
  ORACLE_FUSION_PAYMENT_FIELDS,
  ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
  ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
  ORACLE_FUSION_PAYMENT_TERM_FIELDS,
  ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
  oracleFusionAppliedPrepaymentSchema,
  oracleFusionAvailablePrepaymentSchema,
  oracleFusionInstallmentSchema,
  oracleFusionInvoiceDistributionSchema,
  oracleFusionInvoiceHoldSchema,
  oracleFusionInvoiceLineSchema,
  oracleFusionInvoiceSchema,
  oracleFusionPaymentProcessRequestSchema,
  oracleFusionPaymentRelatedInvoiceSchema,
  oracleFusionPaymentSchema,
  oracleFusionPaymentTermLineSchema,
  oracleFusionPaymentTermSchema,
} from '@/lib/internal/oracle-fusion-financials/schema'
import {
  oracleFusionAppliedPrepaymentOutputProperties,
  oracleFusionAvailablePrepaymentOutputProperties,
  oracleFusionInstallmentOutputProperties,
  oracleFusionInvoiceDistributionOutputProperties,
  oracleFusionInvoiceHoldOutputProperties,
  oracleFusionInvoiceLineOutputProperties,
  oracleFusionInvoiceOutputProperties,
  oracleFusionPaymentOutputProperties,
  oracleFusionPaymentProcessRequestOutputProperties,
  oracleFusionPaymentRelatedInvoiceOutputProperties,
  oracleFusionPaymentTermLineOutputProperties,
  oracleFusionPaymentTermOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const RESOURCE_PATH = '/fscmRestApi/resources/11.13.18.05'
const AUTH = {
  oauthCredential: 'credential-id',
  accessToken: 'short-lived-access-token',
  instanceUrl: ORIGIN,
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
    arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
  }
}

function page(
  items: unknown[],
  options: { limit?: number; offset?: number; totalResults?: number } = {}
) {
  return {
    items,
    count: items.length,
    hasMore: false,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    ...(options.totalResults === undefined ? {} : { totalResults: options.totalResults }),
  }
}

function selfLink(path: string) {
  return [{ rel: 'self', href: `${ORIGIN}${path}` }]
}

function item(path: string, values: Record<string, unknown> = {}) {
  return { ...values, UnexpectedFlexfield: 'must not escape', links: selfLink(path) }
}

interface OperationCase {
  name: string
  toolId: OracleFusionFinancialsToolId
  path: string
  fields: readonly string[]
  input?: Record<string, unknown>
  wrapper?: string
  item: Record<string, unknown>
  derivedKey?: { name: string; value: string }
}

const INVOICE_PATH = `${RESOURCE_PATH}/invoices/INVOICEKEY`
const LINE_COLLECTION_PATH = `${INVOICE_PATH}/child/invoiceLines`
const LINE_PATH = `${LINE_COLLECTION_PATH}/LINEKEY`
const INSTALLMENT_COLLECTION_PATH = `${INVOICE_PATH}/child/invoiceInstallments`
const INSTALLMENT_PATH = `${INSTALLMENT_COLLECTION_PATH}/INSTALLMENTKEY`
const DISTRIBUTION_COLLECTION_PATH = `${LINE_PATH}/child/invoiceDistributions`
const APPLIED_COLLECTION_PATH = `${INVOICE_PATH}/child/appliedPrepayments`
const AVAILABLE_COLLECTION_PATH = `${INVOICE_PATH}/child/availablePrepayments`
const PAYMENT_PATH = `${RESOURCE_PATH}/payablesPayments/42`
const RELATED_COLLECTION_PATH = `${PAYMENT_PATH}/child/relatedInvoices`
const TERM_PATH = `${RESOURCE_PATH}/payablesPaymentTerms/73`
const TERM_LINE_COLLECTION_PATH = `${TERM_PATH}/child/payablesPaymentTermsLines`

const OPERATION_CASES: OperationCase[] = [
  {
    name: 'list invoices',
    toolId: 'oracle_fusion_financials_list_payables_invoices',
    path: `${RESOURCE_PATH}/invoices`,
    fields: ORACLE_FUSION_INVOICE_FIELDS,
    item: item(INVOICE_PATH, { InvoiceId: 1, InvoiceNumber: 'INV-1' }),
    derivedKey: { name: 'invoiceUniqId', value: 'INVOICEKEY' },
  },
  {
    name: 'get invoice',
    toolId: 'oracle_fusion_financials_get_payables_invoice',
    path: INVOICE_PATH,
    fields: ORACLE_FUSION_INVOICE_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    wrapper: 'invoice',
    item: item(INVOICE_PATH, { InvoiceId: 1, InvoiceNumber: 'INV-1' }),
    derivedKey: { name: 'invoiceUniqId', value: 'INVOICEKEY' },
  },
  {
    name: 'list invoice lines',
    toolId: 'oracle_fusion_financials_list_payables_invoice_lines',
    path: LINE_COLLECTION_PATH,
    fields: ORACLE_FUSION_INVOICE_LINE_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(LINE_PATH, { LineNumber: 1, LineAmount: 12.5 }),
    derivedKey: { name: 'invoiceLineUniqId', value: 'LINEKEY' },
  },
  {
    name: 'get invoice line',
    toolId: 'oracle_fusion_financials_get_payables_invoice_line',
    path: LINE_PATH,
    fields: ORACLE_FUSION_INVOICE_LINE_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY' },
    wrapper: 'invoiceLine',
    item: item(LINE_PATH, { LineNumber: 1, LineAmount: 12.5 }),
    derivedKey: { name: 'invoiceLineUniqId', value: 'LINEKEY' },
  },
  {
    name: 'list invoice installments',
    toolId: 'oracle_fusion_financials_list_payables_invoice_installments',
    path: INSTALLMENT_COLLECTION_PATH,
    fields: ORACLE_FUSION_INSTALLMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(INSTALLMENT_PATH, { InstallmentNumber: 1, DueDate: '2026-09-30' }),
    derivedKey: { name: 'invoiceInstallmentUniqId', value: 'INSTALLMENTKEY' },
  },
  {
    name: 'get invoice installment',
    toolId: 'oracle_fusion_financials_get_payables_invoice_installment',
    path: INSTALLMENT_PATH,
    fields: ORACLE_FUSION_INSTALLMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', invoiceInstallmentUniqId: 'INSTALLMENTKEY' },
    wrapper: 'invoiceInstallment',
    item: item(INSTALLMENT_PATH, { InstallmentNumber: 1, DueDate: '2026-09-30' }),
    derivedKey: { name: 'invoiceInstallmentUniqId', value: 'INSTALLMENTKEY' },
  },
  {
    name: 'list invoice distributions',
    toolId: 'oracle_fusion_financials_list_payables_invoice_distributions',
    path: DISTRIBUTION_COLLECTION_PATH,
    fields: ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY' },
    item: item(`${DISTRIBUTION_COLLECTION_PATH}/99`, { InvoiceDistributionId: 99 }),
  },
  {
    name: 'get invoice distribution',
    toolId: 'oracle_fusion_financials_get_payables_invoice_distribution',
    path: `${DISTRIBUTION_COLLECTION_PATH}/99`,
    fields: ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
    input: {
      invoiceUniqId: 'INVOICEKEY',
      invoiceLineUniqId: 'LINEKEY',
      invoiceDistributionId: '99',
    },
    wrapper: 'invoiceDistribution',
    item: item(`${DISTRIBUTION_COLLECTION_PATH}/99`, { InvoiceDistributionId: 99 }),
  },
  {
    name: 'list applied prepayments',
    toolId: 'oracle_fusion_financials_list_payables_applied_prepayments',
    path: APPLIED_COLLECTION_PATH,
    fields: ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(`${APPLIED_COLLECTION_PATH}/APPLIEDKEY`, { AppliedAmount: 40 }),
    derivedKey: { name: 'appliedPrepaymentUniqId', value: 'APPLIEDKEY' },
  },
  {
    name: 'get applied prepayment',
    toolId: 'oracle_fusion_financials_get_payables_applied_prepayment',
    path: `${APPLIED_COLLECTION_PATH}/APPLIEDKEY`,
    fields: ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', appliedPrepaymentUniqId: 'APPLIEDKEY' },
    wrapper: 'appliedPrepayment',
    item: item(`${APPLIED_COLLECTION_PATH}/APPLIEDKEY`, { AppliedAmount: 40 }),
    derivedKey: { name: 'appliedPrepaymentUniqId', value: 'APPLIEDKEY' },
  },
  {
    name: 'list available prepayments',
    toolId: 'oracle_fusion_financials_list_payables_available_prepayments',
    path: AVAILABLE_COLLECTION_PATH,
    fields: ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY' },
    item: item(`${AVAILABLE_COLLECTION_PATH}/AVAILABLEKEY`, { AvailableAmount: 60 }),
    derivedKey: { name: 'availablePrepaymentUniqId', value: 'AVAILABLEKEY' },
  },
  {
    name: 'get available prepayment',
    toolId: 'oracle_fusion_financials_get_payables_available_prepayment',
    path: `${AVAILABLE_COLLECTION_PATH}/AVAILABLEKEY`,
    fields: ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
    input: { invoiceUniqId: 'INVOICEKEY', availablePrepaymentUniqId: 'AVAILABLEKEY' },
    wrapper: 'availablePrepayment',
    item: item(`${AVAILABLE_COLLECTION_PATH}/AVAILABLEKEY`, { AvailableAmount: 60 }),
    derivedKey: { name: 'availablePrepaymentUniqId', value: 'AVAILABLEKEY' },
  },
  {
    name: 'list payments',
    toolId: 'oracle_fusion_financials_list_payables_payments',
    path: `${RESOURCE_PATH}/payablesPayments`,
    fields: ORACLE_FUSION_PAYMENT_FIELDS,
    item: item(PAYMENT_PATH, { CheckId: 42, PaymentAmount: 100 }),
  },
  {
    name: 'get payment',
    toolId: 'oracle_fusion_financials_get_payables_payment',
    path: PAYMENT_PATH,
    fields: ORACLE_FUSION_PAYMENT_FIELDS,
    input: { checkId: '42' },
    wrapper: 'payment',
    item: item(PAYMENT_PATH, { CheckId: 42, PaymentAmount: 100 }),
  },
  {
    name: 'list payment-related invoices',
    toolId: 'oracle_fusion_financials_list_payables_payment_related_invoices',
    path: RELATED_COLLECTION_PATH,
    fields: ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
    input: { checkId: '42' },
    item: item(`${RELATED_COLLECTION_PATH}/88`, { InvoicePaymentId: 88, CheckId: 42 }),
  },
  {
    name: 'get payment-related invoice',
    toolId: 'oracle_fusion_financials_get_payables_payment_related_invoice',
    path: `${RELATED_COLLECTION_PATH}/88`,
    fields: ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
    input: { checkId: '42', invoicePaymentId: '88' },
    wrapper: 'paymentRelatedInvoice',
    item: item(`${RELATED_COLLECTION_PATH}/88`, { InvoicePaymentId: 88, CheckId: 42 }),
  },
  {
    name: 'list payment process requests',
    toolId: 'oracle_fusion_financials_list_payment_process_requests',
    path: `${RESOURCE_PATH}/paymentProcessRequests`,
    fields: ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
    item: item(`${RESOURCE_PATH}/paymentProcessRequests/17`, { PaymentProcessRequestId: 17 }),
  },
  {
    name: 'get payment process request',
    toolId: 'oracle_fusion_financials_get_payment_process_request',
    path: `${RESOURCE_PATH}/paymentProcessRequests/17`,
    fields: ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
    input: { paymentProcessRequestId: '17' },
    wrapper: 'paymentProcessRequest',
    item: item(`${RESOURCE_PATH}/paymentProcessRequests/17`, { PaymentProcessRequestId: 17 }),
  },
  {
    name: 'list invoice holds',
    toolId: 'oracle_fusion_financials_list_payables_invoice_holds',
    path: `${RESOURCE_PATH}/invoiceHolds`,
    fields: ORACLE_FUSION_INVOICE_HOLD_FIELDS,
    item: item(`${RESOURCE_PATH}/invoiceHolds/21`, { HoldId: 21, HoldName: 'Amount' }),
  },
  {
    name: 'get invoice hold',
    toolId: 'oracle_fusion_financials_get_payables_invoice_hold',
    path: `${RESOURCE_PATH}/invoiceHolds/21`,
    fields: ORACLE_FUSION_INVOICE_HOLD_FIELDS,
    input: { holdId: '21' },
    wrapper: 'invoiceHold',
    item: item(`${RESOURCE_PATH}/invoiceHolds/21`, { HoldId: 21, HoldName: 'Amount' }),
  },
  {
    name: 'list payment terms',
    toolId: 'oracle_fusion_financials_list_payables_payment_terms',
    path: `${RESOURCE_PATH}/payablesPaymentTerms`,
    fields: ORACLE_FUSION_PAYMENT_TERM_FIELDS,
    item: item(TERM_PATH, { termsId: 73, name: 'Net 30' }),
  },
  {
    name: 'get payment term',
    toolId: 'oracle_fusion_financials_get_payables_payment_term',
    path: TERM_PATH,
    fields: ORACLE_FUSION_PAYMENT_TERM_FIELDS,
    input: { termsId: '73' },
    wrapper: 'paymentTerm',
    item: item(TERM_PATH, { termsId: 73, name: 'Net 30' }),
  },
  {
    name: 'list payment term lines',
    toolId: 'oracle_fusion_financials_list_payables_payment_term_lines',
    path: TERM_LINE_COLLECTION_PATH,
    fields: ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
    input: { termsId: '73' },
    item: item(`${TERM_LINE_COLLECTION_PATH}/TERMLINEKEY`, { termsId: 73, sequenceNumber: 1 }),
    derivedKey: { name: 'paymentTermLineUniqId', value: 'TERMLINEKEY' },
  },
  {
    name: 'get payment term line',
    toolId: 'oracle_fusion_financials_get_payables_payment_term_line',
    path: `${TERM_LINE_COLLECTION_PATH}/TERMLINEKEY`,
    fields: ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
    input: { termsId: '73', paymentTermLineUniqId: 'TERMLINEKEY' },
    wrapper: 'paymentTermLine',
    item: item(`${TERM_LINE_COLLECTION_PATH}/TERMLINEKEY`, { termsId: 73, sequenceNumber: 1 }),
    derivedKey: { name: 'paymentTermLineUniqId', value: 'TERMLINEKEY' },
  },
]

const BOOLEAN_FIELDS = new Set([
  'CanceledFlag',
  'DiscardedFlag',
  'enabledFlag',
  'HoldFlag',
  'IncludedonInvoiceFlag',
  'ReconciledFlag',
  'ReversedFlag',
  'TrackAsAssetFlag',
])
const NUMBER_FIELDS = new Set([
  'AmountPaid',
  'AmountPaidInvoiceCurrency',
  'AmountPaidPaymentCurrency',
  'amountDue',
  'AppliedAmount',
  'AvailableAmount',
  'BaseAmount',
  'CheckId',
  'CrossCurrencyRate',
  'cutoffDay',
  'dayOfMonth',
  'days',
  'DiscountLost',
  'DiscountTaken',
  'DistributionAmount',
  'DistributionLineNumber',
  'duePercent',
  'firstDiscountDayOfMonth',
  'firstDiscountDays',
  'firstDiscountMonthsForward',
  'firstDiscountPercent',
  'FirstDiscountAmount',
  'GrossAmount',
  'HoldId',
  'IncludedTax',
  'InstallmentNumber',
  'InvoiceAmount',
  'InvoiceBaseAmount',
  'InvoiceDistributionId',
  'InvoiceId',
  'InvoicePaymentAmount',
  'InvoicePaymentId',
  'LineAmount',
  'LineHeld',
  'LineNumber',
  'monthsAhead',
  'PaymentAmount',
  'PaymentBaseAmount',
  'PaymentId',
  'PaymentNumber',
  'PaymentPriority',
  'PaymentProcessRequestId',
  'PaymentReference',
  'PurchaseOrderDistributionLineNumber',
  'PurchaseOrderLineNumber',
  'PurchaseOrderScheduleLineNumber',
  'Quantity',
  'rank',
  'ReceiptLineNumber',
  'secondDiscountDayOfMonth',
  'secondDiscountDays',
  'secondDiscountMonthsForward',
  'secondDiscountPercent',
  'SecondDiscountAmount',
  'sequenceNumber',
  'setId',
  'SourceApplicationIdentifier',
  'termsId',
  'thirdDiscountDayOfMonth',
  'thirdDiscountDays',
  'thirdDiscountMonthsForward',
  'thirdDiscountPercent',
  'ThirdDiscountAmount',
  'UnitPrice',
  'UnpaidAmount',
])

const NON_NULLABLE_FIELDS = {
  invoice: new Set([
    'InvoiceId',
    'InvoiceNumber',
    'SupplierNumber',
    'BusinessUnit',
    'InvoiceAmount',
    'InvoiceCurrency',
    'InvoiceDate',
    'AccountingDate',
    'PaidStatus',
    'ApprovalStatus',
    'PaymentTerms',
    'PaymentMethod',
    'CreationDate',
    'LastUpdateDate',
  ]),
  invoiceLine: new Set([
    'LineNumber',
    'AccountingDate',
    'ApprovalStatus',
    'CreationDate',
    'LastUpdateDate',
  ]),
  installment: new Set([
    'InstallmentNumber',
    'DueDate',
    'GrossAmount',
    'PaymentMethod',
    'PaymentPriority',
    'CreationDate',
    'LastUpdateDate',
  ]),
  invoiceDistribution: new Set([
    'InvoiceDistributionId',
    'DistributionLineNumber',
    'DistributionAmount',
    'AccountingDate',
    'AccountingStatus',
    'MatchedStatus',
    'FundsStatus',
    'PurchaseOrderNumber',
    'PurchaseOrderLineNumber',
    'PurchaseOrderScheduleLineNumber',
    'PurchaseOrderDistributionLineNumber',
    'ReceiptLineNumber',
    'TrackAsAssetFlag',
    'CreationDate',
    'LastUpdateDate',
  ]),
  appliedPrepayment: new Set([
    'InvoiceNumber',
    'SupplierSite',
    'Currency',
    'ApplicationAccountingDate',
  ]),
  availablePrepayment: new Set(['InvoiceNumber', 'LineNumber', 'SupplierSite', 'Currency']),
  payment: new Set([
    'CheckId',
    'PaymentNumber',
    'PaymentAmount',
    'PaymentCurrency',
    'PaymentDate',
    'SupplierNumber',
    'PaymentMethod',
    'PaymentStatus',
    'BusinessUnit',
    'LegalEntity',
    'CreationDate',
    'LastUpdateDate',
  ]),
  paymentRelatedInvoice: new Set([
    'InvoicePaymentId',
    'CheckId',
    'InvoiceId',
    'InvoiceNumber',
    'InstallmentNumber',
    'AmountPaidPaymentCurrency',
    'CreationDate',
    'LastUpdateDate',
  ]),
  invoiceHold: new Set([
    'HoldId',
    'HoldDate',
    'WorkflowStatus',
    'PurchaseOrderNumber',
    'PurchaseOrderLineNumber',
    'PurchaseOrderScheduleLineNumber',
    'ReceiptLineNumber',
    'CreationDate',
    'LastUpdateDate',
  ]),
  paymentProcessRequest: new Set([
    'PaymentProcessRequestId',
    'PaymentProcessRequestName',
    'SourceApplicationIdentifier',
    'PaymentProcessRequestStatusCode',
  ]),
  paymentTerm: new Set([
    'termsId',
    'name',
    'enabledFlag',
    'fromDate',
    'setId',
    'creationDate',
    'lastUpdateDate',
  ]),
  paymentTermLine: new Set(['termsId', 'sequenceNumber']),
} as const

function documentedFixture(fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      BOOLEAN_FIELDS.has(field) ? true : NUMBER_FIELDS.has(field) ? 1 : 'value',
    ])
  )
}

const RESOURCE_SCHEMA_CASES = [
  ['invoice', oracleFusionInvoiceSchema, ORACLE_FUSION_INVOICE_FIELDS, NON_NULLABLE_FIELDS.invoice],
  [
    'invoice line',
    oracleFusionInvoiceLineSchema,
    ORACLE_FUSION_INVOICE_LINE_FIELDS,
    NON_NULLABLE_FIELDS.invoiceLine,
  ],
  [
    'installment',
    oracleFusionInstallmentSchema,
    ORACLE_FUSION_INSTALLMENT_FIELDS,
    NON_NULLABLE_FIELDS.installment,
  ],
  [
    'invoice distribution',
    oracleFusionInvoiceDistributionSchema,
    ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
    NON_NULLABLE_FIELDS.invoiceDistribution,
  ],
  [
    'applied prepayment',
    oracleFusionAppliedPrepaymentSchema,
    ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
    NON_NULLABLE_FIELDS.appliedPrepayment,
  ],
  [
    'available prepayment',
    oracleFusionAvailablePrepaymentSchema,
    ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
    NON_NULLABLE_FIELDS.availablePrepayment,
  ],
  ['payment', oracleFusionPaymentSchema, ORACLE_FUSION_PAYMENT_FIELDS, NON_NULLABLE_FIELDS.payment],
  [
    'payment-related invoice',
    oracleFusionPaymentRelatedInvoiceSchema,
    ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
    NON_NULLABLE_FIELDS.paymentRelatedInvoice,
  ],
  [
    'invoice hold',
    oracleFusionInvoiceHoldSchema,
    ORACLE_FUSION_INVOICE_HOLD_FIELDS,
    NON_NULLABLE_FIELDS.invoiceHold,
  ],
  [
    'payment process request',
    oracleFusionPaymentProcessRequestSchema,
    ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
    NON_NULLABLE_FIELDS.paymentProcessRequest,
  ],
  [
    'payment term',
    oracleFusionPaymentTermSchema,
    ORACLE_FUSION_PAYMENT_TERM_FIELDS,
    NON_NULLABLE_FIELDS.paymentTerm,
  ],
  [
    'payment term line',
    oracleFusionPaymentTermLineSchema,
    ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
    NON_NULLABLE_FIELDS.paymentTermLine,
  ],
] as const

const RESOURCE_OUTPUT_CASES = [
  [ORACLE_FUSION_INVOICE_FIELDS, oracleFusionInvoiceOutputProperties, NON_NULLABLE_FIELDS.invoice],
  [
    ORACLE_FUSION_INVOICE_LINE_FIELDS,
    oracleFusionInvoiceLineOutputProperties,
    NON_NULLABLE_FIELDS.invoiceLine,
  ],
  [
    ORACLE_FUSION_INSTALLMENT_FIELDS,
    oracleFusionInstallmentOutputProperties,
    NON_NULLABLE_FIELDS.installment,
  ],
  [
    ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS,
    oracleFusionInvoiceDistributionOutputProperties,
    NON_NULLABLE_FIELDS.invoiceDistribution,
  ],
  [
    ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS,
    oracleFusionAppliedPrepaymentOutputProperties,
    NON_NULLABLE_FIELDS.appliedPrepayment,
  ],
  [
    ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS,
    oracleFusionAvailablePrepaymentOutputProperties,
    NON_NULLABLE_FIELDS.availablePrepayment,
  ],
  [ORACLE_FUSION_PAYMENT_FIELDS, oracleFusionPaymentOutputProperties, NON_NULLABLE_FIELDS.payment],
  [
    ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS,
    oracleFusionPaymentRelatedInvoiceOutputProperties,
    NON_NULLABLE_FIELDS.paymentRelatedInvoice,
  ],
  [
    ORACLE_FUSION_INVOICE_HOLD_FIELDS,
    oracleFusionInvoiceHoldOutputProperties,
    NON_NULLABLE_FIELDS.invoiceHold,
  ],
  [
    ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS,
    oracleFusionPaymentProcessRequestOutputProperties,
    NON_NULLABLE_FIELDS.paymentProcessRequest,
  ],
  [
    ORACLE_FUSION_PAYMENT_TERM_FIELDS,
    oracleFusionPaymentTermOutputProperties,
    NON_NULLABLE_FIELDS.paymentTerm,
  ],
  [
    ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS,
    oracleFusionPaymentTermLineOutputProperties,
    NON_NULLABLE_FIELDS.paymentTermLine,
  ],
] as const

describe('Oracle Fusion Financials provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSecureFetch.mockReset()
    mockSleep.mockReset().mockResolvedValue(undefined)
    mockValidateUrl.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.25',
      originalHostname: 'vision.fa.us2.oraclecloud.com',
    })
  })

  it.each(OPERATION_CASES)(
    'executes $name with its exact path, fixed projection, and semantic output',
    async (operation) => {
      const isList = operation.wrapper === undefined
      mockSecureFetch.mockResolvedValueOnce(
        response(
          200,
          isList
            ? page([operation.item], { limit: 25, offset: 5, totalResults: 100 })
            : operation.item
        )
      )

      const result = await executeOracleFusionFinancialsOperation(operation.toolId, {
        ...AUTH,
        ...operation.input,
        ...(isList
          ? {
              q: 'Status!=Closed',
              finder: 'PrimaryKey;Id=1',
              orderBy: 'CreationDate:desc',
              limit: 25,
              offset: 5,
              totalResults: true,
            }
          : {}),
        ...(operation.toolId === 'oracle_fusion_financials_list_payables_invoices'
          ? { effectiveDate: '2026-09-02' }
          : {}),
        fields: 'attachments,invoiceDff',
        expand: 'all',
        dependency: 'anything',
        onlyData: true,
      })

      const [requestUrl, resolvedIP, init] = mockSecureFetch.mock.calls[0]
      const url = new URL(requestUrl)
      expect(url.pathname).toBe(operation.path)
      expect(url.searchParams.get('fields')).toBe(operation.fields.join(','))
      expect(url.searchParams.get('links')).toBe('self')
      expect(url.searchParams.has('expand')).toBe(false)
      expect(url.searchParams.has('dependency')).toBe(false)
      expect(url.searchParams.has('onlyData')).toBe(false)
      expect(resolvedIP).toBe('203.0.113.25')
      expect(init).toMatchObject({
        profile: 'configuredEndpoint',
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer short-lived-access-token',
        },
        timeout: 30_000,
        maxRedirects: 0,
        maxResponseBytes: 5 * 1024 * 1024,
      })

      const output = result.output as Record<string, unknown>
      const projected = isList
        ? ((output.items as Array<Record<string, unknown>>)[0] ?? {})
        : (output[operation.wrapper as string] as Record<string, unknown>)
      expect(projected.UnexpectedFlexfield).toBeUndefined()
      if (operation.derivedKey) {
        expect(projected[operation.derivedKey.name]).toBe(operation.derivedKey.value)
      }
      if (isList) {
        expect(url.searchParams.get('q')).toBe('Status!=Closed')
        expect(url.searchParams.get('finder')).toBe('PrimaryKey;Id=1')
        expect(url.searchParams.get('orderBy')).toBe('CreationDate:desc')
        expect(url.searchParams.get('limit')).toBe('25')
        expect(url.searchParams.get('offset')).toBe('5')
        expect(url.searchParams.get('totalResults')).toBe('true')
        expect(output).toMatchObject({
          count: 1,
          hasMore: false,
          limit: 25,
          offset: 5,
          totalResults: 100,
        })
      } else {
        expect(url.searchParams.has('limit')).toBe(false)
        expect(Object.keys(output)).toEqual([operation.wrapper])
      }
    }
  )

  it.each(RESOURCE_SCHEMA_CASES)(
    'accepts documented scalar types and nullable values for the %s projection',
    (_name, schema, fields, nonNullableFields) => {
      expect(schema.parse(documentedFixture(fields))).toMatchObject(documentedFixture(fields))
      const nullableFixture = Object.fromEntries(
        fields.map((field) => [
          field,
          nonNullableFields.has(field) ? documentedFixture([field])[field] : null,
        ])
      )
      expect(schema.parse(nullableFixture)).toMatchObject(nullableFixture)
      for (const field of fields) {
        expect(schema.safeParse({ [field]: null }).success, field).toBe(
          !nonNullableFields.has(field)
        )
      }
    }
  )

  it.each(RESOURCE_OUTPUT_CASES)(
    'publishes Oracle nullability accurately for output metadata case %#',
    (fields, properties, nonNullableFields) => {
      for (const field of fields) {
        expect(properties[field]).toMatchObject({
          optional: true,
          nullable: !nonNullableFields.has(field),
        })
      }
    }
  )

  it.each(RESOURCE_SCHEMA_CASES)(
    'rejects the wrong scalar type for every %s projection field',
    (_name, schema, fields) => {
      for (const field of fields) {
        const wrongValue = BOOLEAN_FIELDS.has(field)
          ? 'not-a-boolean'
          : NUMBER_FIELDS.has(field)
            ? 'not-a-number'
            : 42
        expect(schema.safeParse({ [field]: wrongValue }).success, field).toBe(false)
      }
    }
  )

  it('defaults lists to one page of 50 and forwards invoice effectiveDate', async () => {
    mockSecureFetch.mockResolvedValueOnce(response(200, page([])))
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoices',
      { ...AUTH, effectiveDate: '2026-09-02' }
    )
    const url = new URL(mockSecureFetch.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      effectiveDate: '2026-09-02',
      limit: '50',
      offset: '0',
    })
    expect(url.searchParams.has('totalResults')).toBe(false)
  })

  it('encodes every opaque parent key in nested resource paths', async () => {
    const invoiceUniqId = 'INVOICE key+1'
    const invoiceLineUniqId = 'LINE key+2'
    const collectionPath = `${RESOURCE_PATH}/invoices/INVOICE%20key%2B1/child/invoiceLines/LINE%20key%2B2/child/invoiceDistributions`
    mockSecureFetch.mockResolvedValueOnce(
      response(200, page([item(`${collectionPath}/99`, { InvoiceDistributionId: 99 })]))
    )

    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoice_distributions',
      { ...AUTH, invoiceUniqId, invoiceLineUniqId }
    )

    expect(new URL(mockSecureFetch.mock.calls[0][0]).pathname).toBe(collectionPath)
  })

  it.each([
    [{ limit: 101 }, 'limit'],
    [{ limit: 0 }, 'limit'],
    [{ offset: -1 }, 'offset'],
    [{ offset: 1.5 }, 'offset'],
    [{ effectiveDate: '2026-02-30' }, 'effectiveDate'],
  ])('rejects invalid list controls %# before outbound I/O (%s)', async (fields) => {
    await expect(
      executeOracleFusionFinancialsOperation('oracle_fusion_financials_list_payables_invoices', {
        ...AUTH,
        ...fields,
      })
    ).rejects.toBeDefined()
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['oracle_fusion_financials_get_payables_payment', 'checkId', { checkId: '42' }],
    [
      'oracle_fusion_financials_get_payables_invoice_distribution',
      'invoiceDistributionId',
      { invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY', invoiceDistributionId: '99' },
    ],
    [
      'oracle_fusion_financials_get_payables_payment_related_invoice',
      'invoicePaymentId',
      { checkId: '42', invoicePaymentId: '88' },
    ],
    ['oracle_fusion_financials_get_payables_invoice_hold', 'holdId', { holdId: '21' }],
    [
      'oracle_fusion_financials_get_payment_process_request',
      'paymentProcessRequestId',
      { paymentProcessRequestId: '17' },
    ],
    ['oracle_fusion_financials_get_payables_payment_term', 'termsId', { termsId: '73' }],
  ] as const)(
    'rejects invalid decimal path values for %s.%s',
    async (toolId, field, validInput) => {
      for (const invalid of ['-1', '1.5', 'abc', '1/child']) {
        await expect(
          executeOracleFusionFinancialsOperation(toolId, {
            ...AUTH,
            ...validInput,
            [field]: invalid,
          })
        ).rejects.toBeDefined()
      }
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )

  it('rejects missing, duplicate, malformed, cross-origin, wrong-parent, and escaped opaque links', async () => {
    const badLinks = [
      [],
      [
        { rel: 'self', href: `${ORIGIN}${LINE_PATH}` },
        { rel: 'self', href: `${ORIGIN}${LINE_PATH}` },
      ],
      [{ rel: 'self', href: 'not a URL' }],
      [{ rel: 'self', href: `https://attacker.example${LINE_PATH}` }],
      [{ rel: 'self', href: `${ORIGIN}${INSTALLMENT_PATH}` }],
      [{ rel: 'self', href: `${ORIGIN}${LINE_COLLECTION_PATH}/A%2FB` }],
    ]

    for (const links of badLinks) {
      mockSecureFetch.mockResolvedValueOnce(response(200, page([{ LineNumber: 1, links }])))
      await expect(
        executeOracleFusionFinancialsOperation(
          'oracle_fusion_financials_list_payables_invoice_lines',
          { ...AUTH, invoiceUniqId: 'INVOICEKEY' }
        )
      ).rejects.toMatchObject({ status: 502 })
    }
  })

  it('rejects detail self links with a different key, parent, origin, query, or fragment', async () => {
    const badPaths = [
      `${LINE_COLLECTION_PATH}/DIFFERENT`,
      `${RESOURCE_PATH}/invoices/OTHER/child/invoiceLines/LINEKEY`,
      `${LINE_PATH}?fields=all`,
      `${LINE_PATH}#fragment`,
    ]
    const hrefs = [
      ...badPaths.map((path) => `${ORIGIN}${path}`),
      `https://attacker.example${LINE_PATH}`,
    ]

    for (const href of hrefs) {
      mockSecureFetch.mockResolvedValueOnce(
        response(200, { LineNumber: 1, links: [{ rel: 'self', href }] })
      )
      await expect(
        executeOracleFusionFinancialsOperation(
          'oracle_fusion_financials_get_payables_invoice_line',
          { ...AUTH, invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: 'LINEKEY' }
        )
      ).rejects.toMatchObject({ status: 502 })
    }
  })

  it('rejects malformed list envelopes and projected field types', async () => {
    const invalidPayloads = [
      { items: [], count: '0', hasMore: false, limit: 50, offset: 0 },
      { items: [], count: 1, hasMore: false, limit: 50, offset: 0 },
      { count: 1, hasMore: false, limit: 50, offset: 0 },
      page([{ CheckId: 'not-a-number' }]),
    ]
    for (const payload of invalidPayloads) {
      mockSecureFetch.mockResolvedValueOnce(response(200, payload))
      await expect(
        executeOracleFusionFinancialsOperation(
          'oracle_fusion_financials_list_payables_payments',
          AUTH
        )
      ).rejects.toMatchObject({
        name: 'OracleFusionFinancialsProviderError',
        status: 502,
        message: 'Oracle Fusion Financials returned an unexpected response shape',
      })
    }
  })

  it('normalizes a documented empty collection without items to an empty page', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      response(200, { count: 0, hasMore: false, limit: 50, offset: 0 })
    )

    const result = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_payments',
      AUTH
    )

    expect(result.output).toEqual({
      items: [],
      count: 0,
      hasMore: false,
      limit: 50,
      offset: 0,
    })
  })

  it.each(['PaymentReference', 'PaymentNumber'])(
    'rejects a fractional %s even though other payment amounts accept decimals',
    (field) => {
      expect(oracleFusionPaymentSchema.safeParse({ [field]: 1.5 }).success).toBe(false)
    }
  )

  it('maps an oversized or otherwise unreadable response body to a sanitized 502', async () => {
    mockSecureFetch.mockResolvedValueOnce({
      ...response(200, {}),
      text: async () => {
        throw new Error('Response body exceeded the configured 5 MiB limit')
      },
    })

    await expect(
      requestOracleFusionJson(AUTH, { path: `${RESOURCE_PATH}/invoices` })
    ).rejects.toMatchObject({
      name: 'OracleFusionFinancialsProviderError',
      status: 502,
      message: 'Oracle Fusion Financials response could not be read',
    })
  })

  it('retries 429, 503, and 504 at most twice and honors Retry-After', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(response(429, { title: 'slow down' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response(503, { title: 'unavailable' }))
      .mockResolvedValueOnce(response(200, page([])))

    await requestOracleFusionJson(AUTH, { path: `${RESOURCE_PATH}/invoices` })

    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
    expect(mockBackoff).toHaveBeenNthCalledWith(1, 1, 2_000, {
      baseMs: 250,
      maxMs: 5_000,
    })
    expect(mockSleep).toHaveBeenCalledTimes(2)
  })

  it('stops after two retries and surfaces a sanitized Oracle error', async () => {
    const accessToken = 'short/lived+access~token='
    const encodedAccessToken = encodeURIComponent(accessToken)
    const formEncodedAccessToken = new URLSearchParams({ value: accessToken })
      .toString()
      .slice('value='.length)
    mockSecureFetch
      .mockResolvedValueOnce(response(504, { title: 'gateway timeout' }))
      .mockResolvedValueOnce(response(503, { title: 'unavailable' }))
      .mockResolvedValueOnce(
        response(429, {
          title: `Token ${encodedAccessToken}`,
          detail: `Token ${formEncodedAccessToken}`,
          message: 'access_token=provider-detail-canary&scope=read',
        })
      )

    const error = await requestOracleFusionJson(
      { ...AUTH, accessToken },
      { path: `${RESOURCE_PATH}/invoices` }
    ).catch((caught) => caught)
    expect(error).toBeInstanceOf(OracleFusionFinancialsProviderError)
    expect(error).toMatchObject({ status: 429 })
    expect((error as Error).message).toContain('[REDACTED]')
    expect((error as Error).message).not.toContain(accessToken)
    expect((error as Error).message).not.toContain(encodedAccessToken)
    expect((error as Error).message).not.toContain(formEncodedAccessToken)
    expect((error as Error).message).not.toContain('provider-detail-canary')
    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
  })

  it('propagates cancellation before a request and while waiting to retry', async () => {
    const preAborted = new AbortController()
    preAborted.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      requestOracleFusionJson(AUTH, { path: `${RESOURCE_PATH}/invoices` }, preAborted.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })

    const duringRetry = new AbortController()
    mockSecureFetch.mockResolvedValueOnce(response(503, { title: 'unavailable' }))
    mockSleep.mockImplementationOnce(async () => {
      duringRetry.abort(new DOMException('cancelled', 'AbortError'))
    })
    await expect(
      requestOracleFusionJson(AUTH, { path: `${RESOURCE_PATH}/invoices` }, duringRetry.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockSecureFetch).toHaveBeenCalledTimes(1)
  })

  it('maps invalid caller input to 400 and malformed Oracle responses to a sanitized 502', async () => {
    const invalidInput = await executeOracleFusionFinancialsTool({
      toolId: 'oracle_fusion_financials_list_payables_invoices',
      input: { ...AUTH, limit: 101 },
      headers: new Headers(),
      context: { workflowId: 'workflow-1' },
      requestId: 'request-1',
    })
    expect(invalidInput.status).toBe(400)
    await expect(invalidInput.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid Oracle Fusion Financials input',
    })

    mockSecureFetch.mockResolvedValueOnce(
      response(200, { items: [], count: 1, hasMore: false, limit: 50, offset: 0 })
    )
    const malformedResponse = await executeOracleFusionFinancialsTool({
      toolId: 'oracle_fusion_financials_list_payables_invoices',
      input: AUTH,
      headers: new Headers(),
      context: { workflowId: 'workflow-1' },
      requestId: 'request-2',
    })
    expect(malformedResponse.status).toBe(502)
    await expect(malformedResponse.json()).resolves.toEqual({
      success: false,
      output: {},
      error: 'Oracle Fusion Financials returned an unexpected response shape',
    })
  })
})
