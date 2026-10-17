import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeOracleFusionFinancialsTool } from '@/lib/internal/oracle-fusion-financials/execute-tool'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const ROOT = `${ORIGIN}/fscmRestApi/resources/11.13.18.05/`
const AUTH = {
  oauthCredential: 'fixture-credential',
  instanceUrl: ORIGIN,
  accessToken: Buffer.from('fixture-user:fixture-password').toString('base64'),
}
const fetchProvider = inputValidationMockFns.mockSecureFetchWithPinnedIP

function execute(action: string, input: Record<string, unknown> = {}) {
  return executeOracleFusionFinancialsTool({
    toolId: `oracle_fusion_financials_${action}`,
    input: { ...AUTH, ...input },
    headers: new Headers(),
    context: { workflowId: 'fixture-workflow' },
    requestId: 'fixture-request',
  })
}

function self(path: string) {
  return [{ rel: 'self', href: ROOT + path }]
}

describe('Oracle Fusion Financials provider contract', () => {
  beforeEach(() => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'vision.fa.us2.oraclecloud.com',
    })
  })

  it('retains an exact invoice identity and opaque key while returning only the requested page', async () => {
    fetchProvider.mockResolvedValue(
      new Response(
        `{"items":[{"InvoiceId":999999999999999999,"InvoiceNumber":"INV-1","InvoiceAmount":125.5,"Description":null,"unselectedField":"omitted","@context":{"links":${JSON.stringify(self('invoices/opaque-key'))}}}],"count":1,"hasMore":true,"limit":1,"offset":2,"totalResults":10}`
      )
    )
    const response = await execute('list_payables_invoices', { limit: 1, offset: 2 })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      output: {
        items: [
          {
            invoiceUniqId: 'opaque-key',
            InvoiceId: '999999999999999999',
            InvoiceNumber: 'INV-1',
            InvoiceAmount: 125.5,
            Description: null,
          },
        ],
        count: 1,
        hasMore: true,
        limit: 1,
        offset: 2,
        totalResults: 10,
      },
    })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })

  it('rejects a provider page exceeding the requested limit instead of materializing extra records', async () => {
    fetchProvider.mockResolvedValue(
      jsonResponse({
        items: [{}, {}],
        count: 2,
        hasMore: false,
        limit: 2,
        offset: 0,
      })
    )
    const response = await execute('list_gl_balances', { limit: 1 })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ success: false, output: {} })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })

  it('creates an expense report with exact numeric IDs and returns the provider-assigned navigation key', async () => {
    fetchProvider.mockResolvedValue(
      new Response(
        `{"ExpenseReportId":999999999999999998,"OrgId":999999999999999999,"Purpose":"Travel","links":${JSON.stringify(self('expenseReports/report-key'))}}`
      )
    )
    const response = await execute('create_expense_report', {
      orgId: '999999999999999999',
      purpose: 'Travel',
    })
    expect(await response.json()).toEqual({
      success: true,
      output: {
        expenseReport: {
          ExpenseReportId: '999999999999999998',
          OrgId: '999999999999999999',
          Purpose: 'Travel',
          expenseReportUniqId: 'report-key',
        },
      },
    })
    expect(fetchProvider.mock.calls[0][2]?.body).toBe(
      '{"OrgId":999999999999999999,"Purpose":"Travel"}'
    )
  })

  it('keeps an explicit null patch distinct from an omitted field', async () => {
    fetchProvider.mockResolvedValue(
      jsonResponse({ Purpose: null, links: self('expenseReports/report-key') })
    )
    const response = await execute('update_expense_report', {
      expenseReportUniqId: ' report-key ',
      purpose: null,
    })
    expect(response.status).toBe(200)
    expect(fetchProvider.mock.calls[0][2]).toMatchObject({
      method: 'PATCH',
      body: '{"Purpose":null}',
    })
    expect((await response.json()).output.expenseReport).toEqual({
      Purpose: null,
      expenseReportUniqId: 'report-key',
    })
  })

  it('applies a partial receipt without rounding the installment identifier', async () => {
    fetchProvider.mockResolvedValue(jsonResponse({ result: 'SUCCESS' }))
    const response = await execute('apply_receivables_receipt', {
      receivablesReceiptId: '42',
      appliedPaymentScheduleId: '999999999999999999',
      amountApplied: 12.5,
    })
    expect(await response.json()).toEqual({ success: true, output: { result: 'SUCCESS' } })
    expect(fetchProvider.mock.calls[0][0]).toBe(`${ROOT}standardReceipts/42/action/applyReceipt`)
    expect(fetchProvider.mock.calls[0][2]).toMatchObject({
      method: 'POST',
      body: '{"appliedPaymentScheduleId":999999999999999999,"amountApplied":12.5}',
      headers: expect.objectContaining({
        'Content-Type': 'application/vnd.oracle.adf.action+json',
      }),
    })
  })

  it.each([
    ['submit_expense_report', { expenseReportUniqId: 'report-key' }, 'S', true],
    ['submit_expense_report', { expenseReportUniqId: 'report-key' }, '1:EXP-1', false],
    [
      'approve_receivables_invoice',
      { receivablesInvoiceId: '42' },
      'Invoice cannot be approved',
      false,
    ],
    [
      'apply_receivables_receipt',
      { receivablesReceiptId: '42', appliedPaymentScheduleId: '43' },
      'Insufficient balance',
      false,
    ],
  ])(
    'checks the business outcome of %s even with HTTP 200 (%s, %s)',
    async (action, input, result, success) => {
      fetchProvider.mockResolvedValue(jsonResponse({ result }))
      const response = await execute(action, input)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ success, output: { result } })
    }
  )

  it('rejects a created resource whose self link points to another tenant', async () => {
    fetchProvider.mockResolvedValue(
      jsonResponse({
        StandardReceiptId: '42',
        Amount: 10,
        links: [
          {
            rel: 'self',
            href: 'https://different.fa.us2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/standardReceipts/42',
          },
        ],
      })
    )
    const response = await execute('create_receivables_receipt', {
      amount: 10,
      businessUnit: 'Example BU',
      currency: 'USD',
      receiptDate: '2026-01-31',
      receiptMethod: 'Manual',
    })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      success: false,
      output: {},
      error: 'Oracle Fusion Financials returned an unexpected response shape',
    })
  })

  it('does not retry a rejected receipt creation or return the provider error body', async () => {
    fetchProvider.mockResolvedValue(jsonResponse({ message: 'private provider details' }, 503))
    const response = await execute('create_receivables_receipt', {
      amount: 10,
      businessUnit: 'Example BU',
      currency: 'USD',
      receiptDate: '2026-01-31',
      receiptMethod: 'Manual',
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      success: false,
      output: {},
      error: 'Oracle Fusion request failed with HTTP 503',
    })
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })
})
