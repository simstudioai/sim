/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mockRequest,
}))

import type { OracleFusionRequest } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeOracleFusionFinancialsTool } from '@/lib/internal/oracle-fusion-financials/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { OracleFusionFinancialsBlock } from '@/blocks/blocks/oracle_fusion_financials'
import * as financialsTools from '@/tools/oracle_fusion_financials'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'secret-credential-canary',
  instanceUrl: ORIGIN,
}

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oracle_fusion_financials_list_payables_invoices',
    input: AUTH,
    headers: new Headers(),
    context: { workflowId: 'workflow-1', userId: 'user-1', workspaceId: 'workspace-1' },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('Oracle Fusion Financials execution boundary', () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockRequest.mockImplementation((_credential: unknown, request: OracleFusionRequest) => {
      if (request.query?.limit !== undefined) {
        return { items: [], count: 0, hasMore: false, limit: 50, offset: 0 }
      }
      return {
        '@context': {
          links: [
            {
              rel: 'self',
              href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/${request.address.relativePath}`,
            },
          ],
        },
        accessToken: AUTH.accessToken,
      }
    })
  })

  it.each(
    Object.values(financialsTools).filter((tool) =>
      /_payables_|_payment_process_request/.test(tool.id)
    )
  )('executes the real $id declaration and operation', async (tool) => {
    const params = {
      ...AUTH,
      invoiceUniqId: 'invoice-key',
      invoiceLineUniqId: 'line-key',
      invoiceInstallmentUniqId: 'installment-key',
      invoiceDistributionId: '99',
      appliedPrepaymentUniqId: 'applied-key',
      availablePrepaymentUniqId: 'available-key',
      checkId: '42',
      invoicePaymentId: '88',
      holdId: '21',
      paymentProcessRequestId: '17',
      termsId: '73',
      paymentTermLineUniqId: 'term-line-key',
    }
    const input = tool.operation.input(params)
    const response = await executeOracleFusionFinancialsTool(call({ toolId: tool.id, input }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.success).toBe(true)
    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toMatch(/secret-credential-canary|accessToken|instanceUrl/)
  })

  it('distinguishes invalid inputs from malformed provider payloads without reflecting either', async () => {
    const invalid = await executeOracleFusionFinancialsTool(
      call({ input: { ...AUTH, limit: 101 } })
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({
      success: false,
      output: {},
      error: 'Invalid Oracle Fusion Financials input',
    })
    expect(mockRequest).not.toHaveBeenCalled()

    mockRequest.mockResolvedValue({ items: [AUTH], count: 'secret-provider-value' })
    const malformed = await executeOracleFusionFinancialsTool(call())
    expect(malformed.status).toBe(502)
    await expect(malformed.json()).resolves.toEqual({
      success: false,
      output: {},
      error: 'Oracle Fusion Financials returned an unexpected response shape',
    })
  })

  it('preserves the safe shared provider error and hides unexpected internal failures', async () => {
    mockRequest.mockRejectedValueOnce(
      new OracleFusionProviderError('Oracle Fusion request failed', 403)
    )
    const provider = await executeOracleFusionFinancialsTool(call())
    expect(provider.status).toBe(403)
    await expect(provider.json()).resolves.toMatchObject({ error: 'Oracle Fusion request failed' })

    mockRequest.mockRejectedValueOnce(new Error(AUTH.accessToken))
    const internal = await executeOracleFusionFinancialsTool(call())
    expect(internal.status).toBe(500)
    await expect(internal.json()).resolves.toEqual({
      success: false,
      output: {},
      error: 'Oracle Fusion Financials request failed',
    })
  })

  it('forwards cancellation and never reports an aborted request as an ordinary failure', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    mockRequest.mockImplementationOnce((_auth, _request, signal: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      controller.abort(reason)
      throw reason
    })
    await expect(
      executeOracleFusionFinancialsTool(call({ signal: controller.signal }))
    ).rejects.toBe(reason)
    mockRequest.mockClear()
    await expect(
      executeOracleFusionFinancialsTool(call({ signal: controller.signal }))
    ).rejects.toBe(reason)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('rejects unsupported operations without sending a provider request', async () => {
    const result = await executeOracleFusionFinancialsTool(
      call({ toolId: 'oracle_fusion_financials_delete_invoice' })
    )
    expect(result.status).toBe(500)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('coerces block controls only at execution and preserves opaque manual keys', () => {
    const config = OracleFusionFinancialsBlock.tools.config!
    const params = {
      operation: 'oracle_fusion_financials_list_payables_invoice_lines',
      invoiceUniqId: ' opaque%2Fkey ',
      limit: '25',
      offset: '50',
      totalResults: 'true',
    }
    expect(config.tool(params)).toBe(params.operation)
    expect(config.params!(params)).toMatchObject({
      invoiceUniqId: ' opaque%2Fkey ',
      limit: 25,
      offset: 50,
      totalResults: true,
    })
    expect(config.tool({ ...params, limit: 'invalid' })).toBe(params.operation)
    expect(() => config.params!({ ...params, limit: 'invalid' })).toThrow()
  })

  it('coerces write inputs only at execution without rounding identifiers or losing explicit nulls', () => {
    const config = OracleFusionFinancialsBlock.tools.config!
    const params = {
      operation: 'oracle_fusion_financials_apply_receivables_receipt',
      receivablesReceiptId: '42',
      appliedPaymentScheduleId: '9007199254740993',
      amountApplied: '12.5',
    }
    expect(config.tool({ ...params, amountApplied: 'invalid' })).toBe(params.operation)
    expect(config.params!(params)).toMatchObject({
      appliedPaymentScheduleId: '9007199254740993',
      amountApplied: 12.5,
    })
    expect(() => config.params!({ ...params, amountApplied: 'invalid' })).toThrow()
    expect(
      config.params!({
        operation: 'oracle_fusion_financials_update_receivables_receipt',
        receivablesReceiptId: '42',
        conversionRate: null,
      })
    ).toMatchObject({ conversionRate: null })
    expect(
      config.params!({
        operation: 'oracle_fusion_financials_create_receivables_invoice',
        lines: '[{"LineNumber":1,"Quantity":2}]',
      })
    ).toMatchObject({ lines: [{ LineNumber: 1, Quantity: 2 }] })
  })

  it('dispatches receipt application and returns a typed business failure without credential data', async () => {
    mockRequest.mockResolvedValueOnce({ result: 'ERROR', accessToken: AUTH.accessToken })
    const tool = financialsTools.oracleFusionFinancialsApplyReceivablesReceiptTool
    const input = tool.operation.input({
      ...AUTH,
      receivablesReceiptId: '42',
      appliedPaymentScheduleId: '9007199254740993',
    })
    const response = await executeOracleFusionFinancialsTool(call({ toolId: tool.id, input }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      output: { result: 'ERROR' },
      error: 'Oracle Fusion action reported an unsuccessful result',
    })
  })

  it('dispatches report submission and preserves submission errors as a business failure', async () => {
    const controller = new AbortController()
    mockRequest.mockResolvedValueOnce({ result: '1:EXP-42' })
    const tool = financialsTools.oracleFusionFinancialsSubmitExpenseReportTool
    const input = tool.operation.input({ ...AUTH, expenseReportUniqId: ' report key ' })
    const response = await executeOracleFusionFinancialsTool(
      call({ toolId: tool.id, input, signal: controller.signal })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      output: { result: '1:EXP-42' },
    })
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining(AUTH),
      expect.objectContaining({
        address: {
          family: 'fscm',
          relativePath: 'expenseReports/%20report%20key%20/action/submit',
        },
        method: 'POST',
      }),
      controller.signal
    )
  })

  it('dispatches ledger balances with execution-time pagination and unchanged finder text', async () => {
    const tool = financialsTools.oracleFusionFinancialsListGlBalancesTool
    const config = OracleFusionFinancialsBlock.tools.config!
    const finder = 'AccountGroupBalanceFinder;accountGroupName=Cash,ledgerName=US Primary'
    const params = config.params!({
      ...AUTH,
      operation: tool.id,
      finder,
      limit: '25',
      offset: '50',
    })
    mockRequest.mockResolvedValueOnce({
      items: [{ EndingBalance: '#MISSING' }],
      count: 1,
      hasMore: false,
      limit: 25,
      offset: 50,
    })
    const response = await executeOracleFusionFinancialsTool(
      call({ toolId: tool.id, input: tool.operation.input(params) })
    )
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      output: { items: [{ EndingBalance: '#MISSING' }], limit: 25, offset: 50 },
    })
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining(AUTH),
      expect.objectContaining({
        address: { family: 'fscm', relativePath: 'ledgerBalances' },
        query: expect.objectContaining({ finder, limit: 25, offset: 50 }),
      }),
      undefined
    )
  })
})
