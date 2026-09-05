/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ operation: vi.fn(), job: vi.fn(), file: vi.fn() }))
vi.mock('@/lib/internal/oracle-epm-enterprise-profitability/operations', () => ({
  executeOracleEpcmOperation: mocks.operation,
}))
vi.mock('@/lib/internal/oracle-epm-enterprise-profitability/jobs', () => ({
  executeOracleEpcmJobOperation: mocks.job,
}))
vi.mock('@/lib/internal/oracle-epm-enterprise-profitability/files.server', () => ({
  executeOracleEpcmFileOperation: mocks.file,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { executeOracleEpcmTool } from '@/lib/internal/oracle-epm-enterprise-profitability/execute-tool'
import { OracleEpcmOperationError } from '@/lib/internal/oracle-epm-enterprise-profitability/normalizers'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function call(operation: string): InternalToolOperationCall {
  return {
    toolId: `oracle_epm_enterprise_profitability_${operation}`,
    input: { oauthCredential: 'credential-1', userId: 'untrusted' },
    context: { workflowId: 'workflow-1', userId: 'trusted-user' },
    headers: new Headers(),
    requestId: 'request-1',
    signal: new AbortController().signal,
  }
}
describe('Oracle EPCM direct tool handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of Object.values(mocks)) mock.mockResolvedValue({ success: true, output: {} })
  })
  it.each([
    'list_applications',
    'get_member',
    'add_member',
    'list_job_definitions',
    'generate_model_documentation',
    'validate_model',
    'calculate_model',
    'clear_pov',
    'copy_pov',
    'delete_pov',
    'export_data_slice',
    'import_data_slice',
    'import_data',
    'export_data',
    'import_metadata',
    'export_metadata',
  ])('dispatches %s without an internal HTTP hop', async (operation) => {
    const request = call(operation)
    expect((await executeOracleEpcmTool(request)).status).toBe(200)
    expect(mocks.operation).toHaveBeenCalledWith(operation, request.input, request.signal)
  })
  it.each(['get_job_status', 'wait_for_job', 'get_job_details', 'get_child_job_details'])(
    'forwards cancellation for %s',
    async (operation) => {
      const request = call(operation)
      await executeOracleEpcmTool(request)
      expect(mocks.job).toHaveBeenCalledWith(operation, request.input, request.signal)
    }
  )
  it.each(['list_files', 'upload_file', 'download_file', 'delete_file'])(
    'forwards trusted context for %s',
    async (operation) => {
      const request = call(operation)
      await executeOracleEpcmTool(request)
      expect(mocks.file).toHaveBeenCalledWith(
        operation,
        request.input,
        request.signal,
        request.context
      )
    }
  )
  it.each([
    [new OracleEpcmOperationError('Invalid application', 400), 400, 'Invalid application'],
    [oracleEpmLocalError('invalid_response'), 502, 'Oracle EPM returned an invalid response'],
    [oracleEpmLocalError('timeout'), 408, 'The Oracle EPM request timed out'],
    [
      oracleEpmLocalError('payload_too_large'),
      413,
      'The Oracle EPM payload exceeded the allowed size',
    ],
    [new Error('credential-secret-canary'), 500, 'Oracle EPCM operation failed'],
  ])(
    'returns safe failures and disallows automatic resubmission',
    async (error, status, message) => {
      mocks.operation.mockRejectedValue(error)
      const response = await executeOracleEpcmTool(call('calculate_model'))
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
    const response = await executeOracleEpcmTool(call('wait_for_job'))
    expect(response.status).toBe(408)
    expect((await response.json()).error).toContain('remote job was not cancelled')
  })
  it('propagates aborts and rejects other tool namespaces', async () => {
    const request = call('calculate_model')
    request.signal = AbortSignal.abort()
    await expect(executeOracleEpcmTool(request)).rejects.toThrow()
    expect(mocks.operation).not.toHaveBeenCalled()
    expect(
      (await executeOracleEpcmTool({ ...call('list_files'), toolId: 'unrelated_tool' })).status
    ).toBe(400)
  })
})
