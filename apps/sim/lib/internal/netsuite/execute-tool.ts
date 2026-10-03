import {
  executeNetsuiteAttachRecordOperation,
  executeNetsuiteBatchCreateRecordsOperation,
  executeNetsuiteBatchDeleteRecordsOperation,
  executeNetsuiteBatchGetRecordsOperation,
  executeNetsuiteBatchUpdateRecordsOperation,
  executeNetsuiteBatchUpsertRecordsOperation,
  executeNetsuiteCreateRecordOperation,
  executeNetsuiteDeleteRecordOperation,
  executeNetsuiteDetachRecordOperation,
  executeNetsuiteExecuteActionOperation,
  executeNetsuiteExecuteDatasetOperation,
  executeNetsuiteExecuteSuiteQLOperation,
  executeNetsuiteGetAsyncResultOperation,
  executeNetsuiteGetAsyncStatusOperation,
  executeNetsuiteGetGovernanceLimitsOperation,
  executeNetsuiteGetRecordFormOperation,
  executeNetsuiteGetRecordMetadataOperation,
  executeNetsuiteGetRecordOperation,
  executeNetsuiteGetSelectOptionsOperation,
  executeNetsuiteGetServerTimeOperation,
  executeNetsuiteGetSubresourceOperation,
  executeNetsuiteListDatasetsOperation,
  executeNetsuiteListRecordsOperation,
  executeNetsuiteListRecordTypesOperation,
  executeNetsuiteTransformRecordOperation,
  executeNetsuiteUpdateRecordOperation,
  executeNetsuiteUpsertRecordOperation,
} from '@/lib/internal/netsuite/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeNetsuiteTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'netsuite_attach_record':
      return executeToolOperationImplementation(executeNetsuiteAttachRecordOperation, request)
    case 'netsuite_batch_create_records':
      return executeToolOperationImplementation(executeNetsuiteBatchCreateRecordsOperation, request)
    case 'netsuite_batch_delete_records':
      return executeToolOperationImplementation(executeNetsuiteBatchDeleteRecordsOperation, request)
    case 'netsuite_batch_get_records':
      return executeToolOperationImplementation(executeNetsuiteBatchGetRecordsOperation, request)
    case 'netsuite_batch_update_records':
      return executeToolOperationImplementation(executeNetsuiteBatchUpdateRecordsOperation, request)
    case 'netsuite_batch_upsert_records':
      return executeToolOperationImplementation(executeNetsuiteBatchUpsertRecordsOperation, request)
    case 'netsuite_create_record':
      return executeToolOperationImplementation(executeNetsuiteCreateRecordOperation, request)
    case 'netsuite_delete_record':
      return executeToolOperationImplementation(executeNetsuiteDeleteRecordOperation, request)
    case 'netsuite_detach_record':
      return executeToolOperationImplementation(executeNetsuiteDetachRecordOperation, request)
    case 'netsuite_execute_action':
      return executeToolOperationImplementation(executeNetsuiteExecuteActionOperation, request)
    case 'netsuite_execute_dataset':
      return executeToolOperationImplementation(executeNetsuiteExecuteDatasetOperation, request)
    case 'netsuite_execute_suiteql':
      return executeToolOperationImplementation(executeNetsuiteExecuteSuiteQLOperation, request)
    case 'netsuite_get_async_result':
      return executeToolOperationImplementation(executeNetsuiteGetAsyncResultOperation, request)
    case 'netsuite_get_async_status':
      return executeToolOperationImplementation(executeNetsuiteGetAsyncStatusOperation, request)
    case 'netsuite_get_governance_limits':
      return executeToolOperationImplementation(
        executeNetsuiteGetGovernanceLimitsOperation,
        request
      )
    case 'netsuite_get_record':
      return executeToolOperationImplementation(executeNetsuiteGetRecordOperation, request)
    case 'netsuite_get_record_form':
      return executeToolOperationImplementation(executeNetsuiteGetRecordFormOperation, request)
    case 'netsuite_get_record_metadata':
      return executeToolOperationImplementation(executeNetsuiteGetRecordMetadataOperation, request)
    case 'netsuite_get_select_options':
      return executeToolOperationImplementation(executeNetsuiteGetSelectOptionsOperation, request)
    case 'netsuite_get_server_time':
      return executeToolOperationImplementation(executeNetsuiteGetServerTimeOperation, request)
    case 'netsuite_get_subresource':
      return executeToolOperationImplementation(executeNetsuiteGetSubresourceOperation, request)
    case 'netsuite_list_datasets':
      return executeToolOperationImplementation(executeNetsuiteListDatasetsOperation, request)
    case 'netsuite_list_record_types':
      return executeToolOperationImplementation(executeNetsuiteListRecordTypesOperation, request)
    case 'netsuite_list_records':
      return executeToolOperationImplementation(executeNetsuiteListRecordsOperation, request)
    case 'netsuite_transform_record':
      return executeToolOperationImplementation(executeNetsuiteTransformRecordOperation, request)
    case 'netsuite_update_record':
      return executeToolOperationImplementation(executeNetsuiteUpdateRecordOperation, request)
    case 'netsuite_upsert_record':
      return executeToolOperationImplementation(executeNetsuiteUpsertRecordOperation, request)
    default:
      return Response.json(
        { success: false, error: `Unsupported netsuite tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
