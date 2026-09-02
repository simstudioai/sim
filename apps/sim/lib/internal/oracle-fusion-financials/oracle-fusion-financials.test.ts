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
import { executeOracleFusionFinancialsOperation } from '@/lib/internal/oracle-fusion-financials/operations'
import {
  ORACLE_FUSION_INSTALLMENT_FIELDS,
  ORACLE_FUSION_INVOICE_FIELDS,
  ORACLE_FUSION_INVOICE_LINE_FIELDS,
  ORACLE_FUSION_PAYMENT_FIELDS,
} from '@/lib/internal/oracle-fusion-financials/schema'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const AUTH = {
  oauthCredential: 'credential-id',
  accessToken: 'short-lived-access-token',
  instanceUrl: ORIGIN,
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }
}

function page(items: unknown[]) {
  return { items, count: items.length, hasMore: false, limit: 50, offset: 0 }
}

function invoice(invoiceUniqId = 'OPAQUE123') {
  return {
    InvoiceId: 300100123,
    InvoiceNumber: 'INV-100',
    Supplier: 'Acme',
    InvoiceAmount: 125.5,
    UnexpectedFlexfield: 'must not escape',
    links: [
      {
        rel: 'self',
        href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/invoices/${encodeURIComponent(invoiceUniqId)}`,
      },
      { rel: 'canonical', href: 'https://attacker.example/invoice' },
    ],
  }
}

describe('Oracle Fusion Financials provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrl.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.25',
      originalHostname: 'vision.fa.us2.oraclecloud.com',
    })
  })

  it('builds the fixed invoice query, defaults to one 50-record page, and derives the opaque key', async () => {
    mockSecureFetch.mockResolvedValueOnce(response(200, page([invoice()])))

    const result = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoices',
      {
        ...AUTH,
        fields: 'attachments,invoiceDff',
        expand: 'all',
        dependency: 'anything',
        onlyData: true,
      }
    )

    expect(result).toEqual({
      success: true,
      output: {
        items: [
          {
            invoiceUniqId: 'OPAQUE123',
            InvoiceId: 300100123,
            InvoiceNumber: 'INV-100',
            Supplier: 'Acme',
            InvoiceAmount: 125.5,
          },
        ],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      },
    })
    const [url, resolvedIP, init] = mockSecureFetch.mock.calls[0]
    const parsed = new URL(url)
    expect(resolvedIP).toBe('203.0.113.25')
    expect(parsed.pathname).toBe('/fscmRestApi/resources/11.13.18.05/invoices')
    expect(parsed.searchParams.get('fields')).toBe(ORACLE_FUSION_INVOICE_FIELDS.join(','))
    expect(parsed.searchParams.get('links')).toBe('self')
    expect(parsed.searchParams.get('limit')).toBe('50')
    expect(parsed.searchParams.get('offset')).toBe('0')
    expect(parsed.searchParams.has('totalResults')).toBe(false)
    expect(parsed.searchParams.has('expand')).toBe(false)
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
  })

  it('supports every documented endpoint with encoded keys and only permitted query controls', async () => {
    const opaqueKey = 'opaque key'
    mockSecureFetch
      .mockResolvedValueOnce(response(200, invoice(opaqueKey)))
      .mockResolvedValueOnce(response(200, page([{ LineNumber: 1, LineAmount: 12 }])))
      .mockResolvedValueOnce(response(200, page([{ InstallmentNumber: 1, DueDate: '2026-09-30' }])))
      .mockResolvedValueOnce(response(200, page([{ CheckId: 42, PaymentAmount: 12 }])))
      .mockResolvedValueOnce(response(200, { CheckId: 42, PaymentStatus: 'Cleared' }))

    await executeOracleFusionFinancialsOperation('oracle_fusion_financials_get_payables_invoice', {
      ...AUTH,
      invoiceUniqId: opaqueKey,
    })
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoice_lines',
      { ...AUTH, invoiceUniqId: opaqueKey, q: 'LineAmount>0', limit: 25, offset: 50 }
    )
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoice_installments',
      { ...AUTH, invoiceUniqId: opaqueKey, finder: 'PrimaryKey;InstallmentNumber=1' }
    )
    await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_payments',
      { ...AUTH, orderBy: 'PaymentDate:desc', totalResults: true }
    )
    await executeOracleFusionFinancialsOperation('oracle_fusion_financials_get_payables_payment', {
      ...AUTH,
      checkId: '42',
    })

    const urls = mockSecureFetch.mock.calls.map(([url]) => new URL(url))
    expect(urls.map((url) => url.pathname)).toEqual([
      '/fscmRestApi/resources/11.13.18.05/invoices/opaque%20key',
      '/fscmRestApi/resources/11.13.18.05/invoices/opaque%20key/child/invoiceLines',
      '/fscmRestApi/resources/11.13.18.05/invoices/opaque%20key/child/invoiceInstallments',
      '/fscmRestApi/resources/11.13.18.05/payablesPayments',
      '/fscmRestApi/resources/11.13.18.05/payablesPayments/42',
    ])
    expect(urls[1].searchParams.get('fields')).toBe(ORACLE_FUSION_INVOICE_LINE_FIELDS.join(','))
    expect(urls[1].searchParams.get('q')).toBe('LineAmount>0')
    expect(urls[1].searchParams.get('limit')).toBe('25')
    expect(urls[1].searchParams.get('offset')).toBe('50')
    expect(urls[2].searchParams.get('fields')).toBe(ORACLE_FUSION_INSTALLMENT_FIELDS.join(','))
    expect(urls[3].searchParams.get('fields')).toBe(ORACLE_FUSION_PAYMENT_FIELDS.join(','))
    expect(urls[3].searchParams.get('orderBy')).toBe('PaymentDate:desc')
    expect(urls[3].searchParams.get('totalResults')).toBe('true')
  })

  it('forwards invoice effectiveDate and all allowed invoice list controls', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      response(200, { ...page([]), limit: 100, offset: 10, totalResults: 500 })
    )
    const result = await executeOracleFusionFinancialsOperation(
      'oracle_fusion_financials_list_payables_invoices',
      {
        ...AUTH,
        q: 'PaidStatus!=Paid',
        finder: 'PrimaryKey;InvoiceId=42',
        orderBy: 'InvoiceDate:desc',
        effectiveDate: '2026-09-02',
        limit: 100,
        offset: 10,
        totalResults: true,
      }
    )

    const url = new URL(mockSecureFetch.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'PaidStatus!=Paid',
      finder: 'PrimaryKey;InvoiceId=42',
      orderBy: 'InvoiceDate:desc',
      effectiveDate: '2026-09-02',
      limit: '100',
      offset: '10',
      totalResults: 'true',
    })
    expect(result.output).toMatchObject({ totalResults: 500 })
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

  it.each(['-1', '1.5', 'abc', '1/child'])(
    'rejects invalid payment CheckId %j',
    async (checkId) => {
      await expect(
        executeOracleFusionFinancialsOperation('oracle_fusion_financials_get_payables_payment', {
          ...AUTH,
          checkId,
        })
      ).rejects.toBeDefined()
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )

  it('rejects missing, malformed, cross-origin, and wrong-path invoice self links', async () => {
    const badLinks = [
      [],
      [{ rel: 'self', href: 'not a URL' }],
      [
        {
          rel: 'self',
          href: 'https://attacker.example/fscmRestApi/resources/11.13.18.05/invoices/X',
        },
      ],
      [{ rel: 'self', href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/payablesPayments/42` }],
      [{ rel: 'self', href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/invoices/X/child/lines` }],
    ]

    for (const links of badLinks) {
      mockSecureFetch.mockResolvedValueOnce(response(200, page([{ ...invoice(), links }])))
      await expect(
        executeOracleFusionFinancialsOperation(
          'oracle_fusion_financials_list_payables_invoices',
          AUTH
        )
      ).rejects.toBeDefined()
    }
  })

  it('rejects a detail response whose self link points to a different opaque key', async () => {
    mockSecureFetch.mockResolvedValueOnce(response(200, invoice('DIFFERENT')))
    await expect(
      executeOracleFusionFinancialsOperation('oracle_fusion_financials_get_payables_invoice', {
        ...AUTH,
        invoiceUniqId: 'REQUESTED',
      })
    ).rejects.toMatchObject({
      name: 'OracleFusionFinancialsProviderError',
      status: 502,
      message: 'Oracle Fusion Financials returned an unexpected response shape',
    })
  })

  it('retries 429, 503, and 504 at most twice and honors Retry-After', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(response(429, { title: 'slow down' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response(503, { title: 'unavailable' }))
      .mockResolvedValueOnce(response(200, page([])))

    await requestOracleFusionJson(AUTH, { path: '/fscmRestApi/resources/11.13.18.05/invoices' })

    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
    expect(mockBackoff).toHaveBeenNthCalledWith(1, 1, 2_000, {
      baseMs: 250,
      maxMs: 5_000,
    })
    expect(mockSleep).toHaveBeenCalledTimes(2)
  })

  it('stops after two retries and surfaces a sanitized Oracle error', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(response(504, { title: 'gateway timeout' }))
      .mockResolvedValueOnce(response(503, { title: 'unavailable' }))
      .mockResolvedValueOnce(
        response(429, {
          title: `Token ${AUTH.accessToken}`,
          detail: 'Request temporarily throttled',
        })
      )

    const error = await requestOracleFusionJson(AUTH, {
      path: '/fscmRestApi/resources/11.13.18.05/invoices',
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(OracleFusionFinancialsProviderError)
    expect(error).toMatchObject({ status: 429 })
    expect((error as Error).message).toContain('[REDACTED]')
    expect((error as Error).message).not.toContain(AUTH.accessToken)
    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
  })

  it('propagates cancellation before a request and while waiting to retry', async () => {
    const preAborted = new AbortController()
    preAborted.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      requestOracleFusionJson(
        AUTH,
        { path: '/fscmRestApi/resources/11.13.18.05/invoices' },
        preAborted.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    const duringRetry = new AbortController()
    mockSecureFetch.mockResolvedValueOnce(response(503, { title: 'unavailable' }))
    mockSleep.mockImplementationOnce(async () => {
      duringRetry.abort(new DOMException('cancelled', 'AbortError'))
    })
    await expect(
      requestOracleFusionJson(
        AUTH,
        { path: '/fscmRestApi/resources/11.13.18.05/invoices' },
        duringRetry.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockSecureFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed Oracle list envelopes and projected field types', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(
        response(200, { items: [], count: '0', hasMore: false, limit: 50, offset: 0 })
      )
      .mockResolvedValueOnce(
        response(200, { items: [], count: 1, hasMore: false, limit: 50, offset: 0 })
      )
      .mockResolvedValueOnce(response(200, page([{ CheckId: 'not-a-number' }])))

    await expect(
      executeOracleFusionFinancialsOperation(
        'oracle_fusion_financials_list_payables_payments',
        AUTH
      )
    ).rejects.toBeDefined()
    await expect(
      executeOracleFusionFinancialsOperation(
        'oracle_fusion_financials_list_payables_payments',
        AUTH
      )
    ).rejects.toBeDefined()
    await expect(
      executeOracleFusionFinancialsOperation(
        'oracle_fusion_financials_list_payables_payments',
        AUTH
      )
    ).rejects.toBeDefined()
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
