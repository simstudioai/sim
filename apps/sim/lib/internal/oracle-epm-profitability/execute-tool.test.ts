/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ operation: vi.fn(), job: vi.fn(), file: vi.fn() }))
vi.mock('@/lib/internal/oracle-epm-profitability/operations', () => ({
  executeOraclePcmOperation: mocks.operation,
}))
vi.mock('@/lib/internal/oracle-epm-profitability/jobs', () => ({
  executeOraclePcmJobOperation: mocks.job,
}))
vi.mock('@/lib/internal/oracle-epm-profitability/files.server', () => ({
  executeOraclePcmFileOperation: mocks.file,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { executeOraclePcmTool } from '@/lib/internal/oracle-epm-profitability/execute-tool'
import { OraclePcmOperationError } from '@/lib/internal/oracle-epm-profitability/normalizers'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function call(operation: string): InternalToolOperationCall {
  return {
    toolId: `oracle_epm_profitability_${operation}`,
    input: {
      oauthCredential: 'credential-1',
      accessToken: 'injected-token',
      instanceUrl: 'https://epm.example.com',
      userId: 'untrusted',
    },
    context: { workflowId: 'workflow-1', userId: 'trusted-user' },
    headers: new Headers(),
    requestId: 'request-1',
    signal: new AbortController().signal,
  }
}
describe('Oracle PCM direct tool handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of Object.values(mocks)) mock.mockResolvedValue({ success: true, output: {} })
  })
  it.each([
    'create_application',
    'enable_application',
    'deploy_cube',
    'update_dimensions',
    'load_data',
    'run_calculation',
    'copy_pov',
    'clear_pov',
    'get_rule_balancing',
    'generate_program_documentation',
    'export_query_results',
    'import_template',
    'apply_data_grants',
    'merge_slices',
    'optimize_cube',
  ])('dispatches %s without an internal HTTP hop', async (operation) => {
    const request = call(operation)
    expect((await executeOraclePcmTool(request)).status).toBe(200)
    expect(mocks.operation).toHaveBeenCalledWith(operation, request.input, request.signal)
  })
  it.each(['get_task_status', 'wait_for_task'])(
    'forwards cancellation for %s',
    async (operation) => {
      const request = call(operation)
      await executeOraclePcmTool(request)
      expect(mocks.job).toHaveBeenCalledWith(operation, request.input, request.signal)
    }
  )
  it.each(['list_files', 'upload_file', 'download_file'])(
    'forwards trusted context for %s',
    async (operation) => {
      const request = call(operation)
      await executeOraclePcmTool(request)
      expect(mocks.file).toHaveBeenCalledWith(
        operation,
        request.input,
        request.signal,
        request.context
      )
    }
  )
  it.each([
    [new OraclePcmOperationError('Invalid application', 400), 400, 'Invalid application'],
    [oracleEpmLocalError('invalid_response'), 502, 'Oracle EPM returned an invalid response'],
    [oracleEpmLocalError('timeout'), 408, 'The Oracle EPM request timed out'],
    [
      oracleEpmLocalError('payload_too_large'),
      413,
      'The Oracle EPM payload exceeded the allowed size',
    ],
    [new Error('credential-secret-canary'), 500, 'Oracle PCM operation failed'],
  ])(
    'returns safe failures and disallows automatic resubmission',
    async (error, status, message) => {
      mocks.operation.mockRejectedValue(error)
      const response = await executeOraclePcmTool(call('run_calculation'))
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({
        success: false,
        output: {},
        error: message,
        retryable: false,
      })
    }
  )
  it('distinguishes local timeout from remote cancellation', async () => {
    mocks.job.mockRejectedValue(new DOMException('deadline', 'TimeoutError'))
    const response = await executeOraclePcmTool(call('wait_for_task'))
    expect(response.status).toBe(408)
    expect((await response.json()).error).toContain('remote task was not cancelled')
  })
  it('propagates aborts and rejects other tool namespaces', async () => {
    const request = call('run_calculation')
    request.signal = AbortSignal.abort()
    await expect(executeOraclePcmTool(request)).rejects.toThrow()
    expect(mocks.operation).not.toHaveBeenCalled()
    expect(
      (await executeOraclePcmTool({ ...call('list_files'), toolId: 'unrelated_tool' })).status
    ).toBe(400)
  })
})
