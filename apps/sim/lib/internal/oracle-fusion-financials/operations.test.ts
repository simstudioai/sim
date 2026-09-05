/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

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
} from '@/lib/internal/oracle-fusion-financials/schema'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const RESOURCE_PATH = '/fscmRestApi/resources/11.13.18.05'
const AUTH = {
  oauthCredential: 'credential-id',
  accessToken: Buffer.from('integration-user:password').toString('base64'),
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

describe('Oracle Fusion Financials operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSecureFetch.mockReset()
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
            ? {
                ...page([operation.item], { limit: 25, offset: 5, totalResults: 100 }),
                hasMore: true,
              }
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

      const [requestUrl] = mockSecureFetch.mock.calls[0]
      const url = new URL(requestUrl)
      expect(url.pathname).toBe(operation.path)
      expect(url.searchParams.get('fields')).toBe(operation.fields.join(','))
      expect(url.searchParams.get('links')).toBe('self')
      expect(url.searchParams.has('expand')).toBe(false)
      expect(url.searchParams.has('dependency')).toBe(false)
      expect(url.searchParams.has('onlyData')).toBe(false)
      expect(mockSecureFetch).toHaveBeenCalledTimes(1)

      const output = result.output as Record<string, unknown>
      const projected = isList
        ? ((output.items as Array<Record<string, unknown>>)[0] ?? {})
        : (output[operation.wrapper as string] as Record<string, unknown>)
      expect(projected.UnexpectedFlexfield).toBeUndefined()
      expect(projected.links).toBeUndefined()
      expect(projected['@context']).toBeUndefined()
      expect(output.nextOffset).toBeUndefined()
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
          hasMore: true,
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

  it('round-trips v9 invoice line keys while preserving exact numbers and fixed projections', async () => {
    const providerLine = {
      LineNumber: '9007199254740993',
      ReceiptLineNumber: '999999999999999999',
      LineAmount: 12.5,
      '@context': { links: selfLink(LINE_PATH) },
      UnexpectedFlexfield: 'must not escape',
    }
    mockSecureFetch
      .mockResolvedValueOnce(response(200, page([providerLine])))
      .mockResolvedValueOnce(response(200, providerLine))

    const listed = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoice_lines',
      { ...AUTH, invoiceUniqId: 'INVOICEKEY' }
    )
    const expectedLine = {
      invoiceLineUniqId: 'LINEKEY',
      LineNumber: '9007199254740993',
      ReceiptLineNumber: '999999999999999999',
      LineAmount: 12.5,
    }
    expect(listed.output).toMatchObject({ items: [expectedLine] })
    const detail = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_get_payables_invoice_line',
      { ...AUTH, invoiceUniqId: 'INVOICEKEY', invoiceLineUniqId: expectedLine.invoiceLineUniqId }
    )
    expect(detail.output).toEqual({ invoiceLine: expectedLine })
    expect(new URL(mockSecureFetch.mock.calls[1][0]).pathname).toBe(LINE_PATH)
    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
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
        name: 'OracleFusionProviderError',
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

  it.each(OPERATION_CASES.filter((operation) => operation.input))(
    'requires every parent and resource identifier for $name before fetching',
    async (operation) => {
      for (const key of Object.keys(operation.input ?? {})) {
        await expect(
          executeOracleFusionFinancialsOperation(operation.toolId, {
            ...AUTH,
            ...operation.input,
            [key]: undefined,
          })
        ).rejects.toMatchObject({ name: 'ZodError' })
      }
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )
})
