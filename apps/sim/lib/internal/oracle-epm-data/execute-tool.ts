import {
  executeOracleEpmDataDeleteFileOperation,
  executeOracleEpmDataDownloadFileOperation,
  executeOracleEpmDataExecuteReportOperation,
  executeOracleEpmDataExportDataIntegrationOperation,
  executeOracleEpmDataExportMappingsOperation,
  executeOracleEpmDataGetConnectionOperation,
  executeOracleEpmDataGetJobStatusOperation,
  executeOracleEpmDataGetPipelineDetailsOperation,
  executeOracleEpmDataGetPovStatusOperation,
  executeOracleEpmDataImportDataIntegrationOperation,
  executeOracleEpmDataImportMappingsOperation,
  executeOracleEpmDataListConnectionsOperation,
  executeOracleEpmDataListFilesOperation,
  executeOracleEpmDataRunBatchOperation,
  executeOracleEpmDataRunDataRuleOperation,
  executeOracleEpmDataRunIntegrationOperation,
  executeOracleEpmDataRunPipelineOperation,
  executeOracleEpmDataSetPovLockOperation,
  executeOracleEpmDataUpdateConnectionOperation,
  executeOracleEpmDataUploadFileOperation,
} from '@/lib/internal/oracle-epm-data/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOracleEpmDataTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'oracle_epm_data_delete_file':
      return executeToolOperationImplementation(executeOracleEpmDataDeleteFileOperation, request)
    case 'oracle_epm_data_download_file':
      return executeToolOperationImplementation(executeOracleEpmDataDownloadFileOperation, request)
    case 'oracle_epm_data_execute_report':
      return executeToolOperationImplementation(executeOracleEpmDataExecuteReportOperation, request)
    case 'oracle_epm_data_export_data_integration':
      return executeToolOperationImplementation(
        executeOracleEpmDataExportDataIntegrationOperation,
        request
      )
    case 'oracle_epm_data_export_mappings':
      return executeToolOperationImplementation(
        executeOracleEpmDataExportMappingsOperation,
        request
      )
    case 'oracle_epm_data_get_connection':
      return executeToolOperationImplementation(executeOracleEpmDataGetConnectionOperation, request)
    case 'oracle_epm_data_get_job_status':
      return executeToolOperationImplementation(executeOracleEpmDataGetJobStatusOperation, request)
    case 'oracle_epm_data_get_pipeline_details':
      return executeToolOperationImplementation(
        executeOracleEpmDataGetPipelineDetailsOperation,
        request
      )
    case 'oracle_epm_data_get_pov_status':
      return executeToolOperationImplementation(executeOracleEpmDataGetPovStatusOperation, request)
    case 'oracle_epm_data_import_data_integration':
      return executeToolOperationImplementation(
        executeOracleEpmDataImportDataIntegrationOperation,
        request
      )
    case 'oracle_epm_data_import_mappings':
      return executeToolOperationImplementation(
        executeOracleEpmDataImportMappingsOperation,
        request
      )
    case 'oracle_epm_data_list_connections':
      return executeToolOperationImplementation(
        executeOracleEpmDataListConnectionsOperation,
        request
      )
    case 'oracle_epm_data_list_files':
      return executeToolOperationImplementation(executeOracleEpmDataListFilesOperation, request)
    case 'oracle_epm_data_run_batch':
      return executeToolOperationImplementation(executeOracleEpmDataRunBatchOperation, request)
    case 'oracle_epm_data_run_data_rule':
      return executeToolOperationImplementation(executeOracleEpmDataRunDataRuleOperation, request)
    case 'oracle_epm_data_run_integration':
      return executeToolOperationImplementation(
        executeOracleEpmDataRunIntegrationOperation,
        request
      )
    case 'oracle_epm_data_run_pipeline':
      return executeToolOperationImplementation(executeOracleEpmDataRunPipelineOperation, request)
    case 'oracle_epm_data_set_pov_lock':
      return executeToolOperationImplementation(executeOracleEpmDataSetPovLockOperation, request)
    case 'oracle_epm_data_update_connection':
      return executeToolOperationImplementation(
        executeOracleEpmDataUpdateConnectionOperation,
        request
      )
    case 'oracle_epm_data_upload_file':
      return executeToolOperationImplementation(executeOracleEpmDataUploadFileOperation, request)
    default:
      return Response.json(
        { success: false, error: 'Unsupported Oracle EPM Data Integration tool' },
        { status: 500 }
      )
  }
}
