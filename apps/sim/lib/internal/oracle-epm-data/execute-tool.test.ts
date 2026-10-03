/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  delete_file: vi.fn(),
  download_file: vi.fn(),
  execute_report: vi.fn(),
  export_data_integration: vi.fn(),
  export_mappings: vi.fn(),
  get_connection: vi.fn(),
  get_job_status: vi.fn(),
  get_pipeline_details: vi.fn(),
  get_pov_status: vi.fn(),
  import_data_integration: vi.fn(),
  import_mappings: vi.fn(),
  list_connections: vi.fn(),
  list_files: vi.fn(),
  run_batch: vi.fn(),
  run_data_rule: vi.fn(),
  run_integration: vi.fn(),
  run_pipeline: vi.fn(),
  set_pov_lock: vi.fn(),
  update_connection: vi.fn(),
  upload_file: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm-data/operations', () => ({
  executeOracleEpmDataDeleteFileOperation: mocks.delete_file,
  executeOracleEpmDataDownloadFileOperation: mocks.download_file,
  executeOracleEpmDataExecuteReportOperation: mocks.execute_report,
  executeOracleEpmDataExportDataIntegrationOperation: mocks.export_data_integration,
  executeOracleEpmDataExportMappingsOperation: mocks.export_mappings,
  executeOracleEpmDataGetConnectionOperation: mocks.get_connection,
  executeOracleEpmDataGetJobStatusOperation: mocks.get_job_status,
  executeOracleEpmDataGetPipelineDetailsOperation: mocks.get_pipeline_details,
  executeOracleEpmDataGetPovStatusOperation: mocks.get_pov_status,
  executeOracleEpmDataImportDataIntegrationOperation: mocks.import_data_integration,
  executeOracleEpmDataImportMappingsOperation: mocks.import_mappings,
  executeOracleEpmDataListConnectionsOperation: mocks.list_connections,
  executeOracleEpmDataListFilesOperation: mocks.list_files,
  executeOracleEpmDataRunBatchOperation: mocks.run_batch,
  executeOracleEpmDataRunDataRuleOperation: mocks.run_data_rule,
  executeOracleEpmDataRunIntegrationOperation: mocks.run_integration,
  executeOracleEpmDataRunPipelineOperation: mocks.run_pipeline,
  executeOracleEpmDataSetPovLockOperation: mocks.set_pov_lock,
  executeOracleEpmDataUpdateConnectionOperation: mocks.update_connection,
  executeOracleEpmDataUploadFileOperation: mocks.upload_file,
}))

import { executeOracleEpmDataTool } from '@/lib/internal/oracle-epm-data/execute-tool'

const context = {
  userId: 'trusted-user',
  workflowId: 'trusted-workflow',
  workspaceId: 'trusted-workspace',
}

describe('Data Integration internal dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(mocks))
      operation.mockResolvedValue({ success: true, output: { synthetic: true } })
  })
  it.each(Object.entries(mocks))(
    'dispatches %s with only the trusted execution context',
    async (action, operation) => {
      const signal = new AbortController().signal
      const input = { oauthCredential: 'credential', _context: { userId: 'untrusted-user' } }
      const result = await executeOracleEpmDataTool({
        toolId: `oracle_epm_data_${action}`,
        input,
        signal,
        context,
        headers: new Headers(),
        requestId: 'request',
      })
      expect(await result.json()).toEqual({ success: true, output: { synthetic: true } })
      expect(operation).toHaveBeenCalledExactlyOnceWith(input, signal, context)
    }
  )

  it('rejects unsupported actions, invalid input and aborted calls before dispatch', async () => {
    const base = { context, headers: new Headers(), requestId: 'request' }
    expect(
      (await executeOracleEpmDataTool({ ...base, toolId: 'oracle_epm_data_unknown', input: {} }))
        .status
    ).toBe(500)
    expect(
      (await executeOracleEpmDataTool({ ...base, toolId: 'oracle_epm_data_list_files', input: [] }))
        .status
    ).toBe(400)
    const signal = AbortSignal.abort()
    await expect(
      executeOracleEpmDataTool({ ...base, toolId: 'oracle_epm_data_list_files', input: {}, signal })
    ).rejects.toThrow()
    for (const operation of Object.values(mocks)) expect(operation).not.toHaveBeenCalled()
  })
})
