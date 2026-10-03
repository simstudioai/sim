/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/internal/oracle-epm-tax-reporting/operations', () => ({
  executeTaxReportingOperation: mocks.execute,
  TaxReportingContractError: class extends Error {},
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import { executeTaxReportingTool } from '@/lib/internal/oracle-epm-tax-reporting/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const call: InternalToolOperationCall = {
  toolId: 'oracle_epm_tax_reporting_run_rule',
  requestId: 'request',
  headers: new Headers(),
  context: { userId: 'trusted-user', workflowId: 'trusted-workflow' },
  input: {
    oauthCredential: 'credential',
    accessToken: 'token',
    instanceUrl: 'https://epm.example.com',
    application: 'Tax',
    jobName: 'Tax Rule',
  },
}

describe('Tax Reporting internal tool boundary', () => {
  it('does not treat positive migration/report status as planning cancellation pending', async () => {
    for (const tool of ['list_files', 'generate_report', 'get_report_status']) {
      mocks.execute.mockResolvedValueOnce({ status: 2 })
      const response = await executeTaxReportingTool({
        ...call,
        toolId: `oracle_epm_tax_reporting_${tool}`,
        input: {
          ...(call.input as object),
          groupName: 'Task Manager',
          reportName: 'Late Tasks',
          module: tool === 'generate_report' ? 'FCM' : 'FCCS',
          jobId: '224',
        },
      })
      expect(await response.json()).toMatchObject({
        success: false,
        retryable: false,
        output: { status: 2 },
      })
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue({ status: 0, jobId: '224' })
  })

  it('selects behavior from the registered tool ID and uses only trusted context', async () => {
    const input = {
      ...(call.input as object),
      operation: 'clear_data',
      _context: { userId: 'forged-user' },
      userId: 'forged-user',
    }
    const response = await executeTaxReportingTool({ ...call, input })
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'run_rule' }),
      call.context,
      undefined
    )
    expect(mocks.execute.mock.calls[0][0]).not.toHaveProperty('_context')
    expect(mocks.execute.mock.calls[0][0]).not.toHaveProperty('userId')
    expect(await response.json()).toEqual({ success: true, output: { status: 0, jobId: '224' } })
  })

  it('rejects missing inputs and unregistered IDs without provider calls', async () => {
    expect((await executeTaxReportingTool({ ...call, input: {} })).status).toBe(400)
    expect(
      (
        await executeTaxReportingTool({
          ...call,
          toolId: 'oracle_epm_tax_reporting_delete_application',
        })
      ).status
    ).toBe(500)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('does not reflect credentials or provider exceptions in an error', async () => {
    mocks.execute.mockRejectedValue(new Error('token private-storage-path secret-password'))
    const response = await executeTaxReportingTool(call)
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).not.toContain('secret-password')
    expect(body).not.toContain('private-storage-path')
  })

  it('keeps failed and canceled Oracle jobs distinct from accepted pending jobs', async () => {
    for (const status of [-1, 0, 1, 2, 3, 4, 2147483647]) {
      mocks.execute.mockResolvedValueOnce({ status, jobId: '224' })
      expect(await (await executeTaxReportingTool(call)).json()).toMatchObject({
        success: [-1, 0, 2].includes(status),
        output: { status },
      })
    }
  })
})
