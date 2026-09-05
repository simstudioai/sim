import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OracleEpmError } from '@/lib/internal/oracle-epm'
import { FccsInputError } from '@/lib/internal/oracle-epm-fccs/context'
import {
  executeFccsAddMemberOperation,
  executeFccsClearDataProfileOperation,
  executeFccsClearDataSliceOperation,
  executeFccsCopyDataProfileOperation,
  executeFccsDeleteFileOperation,
  executeFccsDownloadFileOperation,
  executeFccsExecuteJobOperation,
  executeFccsExportApplicationDataOperation,
  executeFccsExportConsolidationRulesetsOperation,
  executeFccsExportDataSliceOperation,
  executeFccsExportJobConsoleOperation,
  executeFccsExportJournalsOperation,
  executeFccsExportMetadataOperation,
  executeFccsGenerateIntercompanyReportOperation,
  executeFccsGetChildJobDetailsOperation,
  executeFccsGetDimensionOperation,
  executeFccsGetJobDetailsOperation,
  executeFccsGetJobOperation,
  executeFccsGetMemberOperation,
  executeFccsImportApplicationDataOperation,
  executeFccsImportConsolidationRulesetsOperation,
  executeFccsImportDataSliceOperation,
  executeFccsImportExchangeRatesOperation,
  executeFccsImportJournalsOperation,
  executeFccsImportMetadataOperation,
  executeFccsListApplicationsOperation,
  executeFccsListCubesOperation,
  executeFccsListDimensionsOperation,
  executeFccsListFilesOperation,
  executeFccsListJobDefinitionsOperation,
  executeFccsListJournalsOperation,
  executeFccsPerformJournalActionOperation,
  executeFccsRunConsolidationOperation,
  executeFccsRunRuleOperation,
  executeFccsRunRulesetOperation,
  executeFccsRunTranslationOperation,
  executeFccsUpdateJournalPeriodOperation,
  executeFccsUploadFileOperation,
  executeFccsValidateMetadataOperation,
  executeFccsWaitForJobOperation,
} from '@/lib/internal/oracle-epm-fccs/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const errorStatuses: Record<OracleEpmError['category'], number> = {
  authentication_required: 401,
  conflict: 409,
  forbidden: 403,
  invalid_configuration: 500,
  invalid_input: 400,
  invalid_response: 502,
  not_found: 404,
  payload_too_large: 413,
  rate_limited: 429,
  service_unavailable: 503,
  timeout: 504,
}

export const executeOracleEpmFccsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  try {
    switch (request.toolId) {
      case 'oracle_epm_fccs_list_applications':
        return await executeToolOperationImplementation(
          executeFccsListApplicationsOperation,
          request
        )
      case 'oracle_epm_fccs_list_cubes':
        return await executeToolOperationImplementation(executeFccsListCubesOperation, request)
      case 'oracle_epm_fccs_list_dimensions':
        return await executeToolOperationImplementation(executeFccsListDimensionsOperation, request)
      case 'oracle_epm_fccs_get_dimension':
        return await executeToolOperationImplementation(executeFccsGetDimensionOperation, request)
      case 'oracle_epm_fccs_get_member':
        return await executeToolOperationImplementation(executeFccsGetMemberOperation, request)
      case 'oracle_epm_fccs_add_member':
        return await executeToolOperationImplementation(executeFccsAddMemberOperation, request)
      case 'oracle_epm_fccs_validate_metadata':
        return await executeToolOperationImplementation(
          executeFccsValidateMetadataOperation,
          request
        )
      case 'oracle_epm_fccs_list_job_definitions':
        return await executeToolOperationImplementation(
          executeFccsListJobDefinitionsOperation,
          request
        )
      case 'oracle_epm_fccs_execute_job':
        return await executeToolOperationImplementation(executeFccsExecuteJobOperation, request)
      case 'oracle_epm_fccs_run_rule':
        return await executeToolOperationImplementation(executeFccsRunRuleOperation, request)
      case 'oracle_epm_fccs_run_ruleset':
        return await executeToolOperationImplementation(executeFccsRunRulesetOperation, request)
      case 'oracle_epm_fccs_run_consolidation':
        return await executeToolOperationImplementation(
          executeFccsRunConsolidationOperation,
          request
        )
      case 'oracle_epm_fccs_run_translation':
        return await executeToolOperationImplementation(executeFccsRunTranslationOperation, request)
      case 'oracle_epm_fccs_get_job':
        return await executeToolOperationImplementation(executeFccsGetJobOperation, request)
      case 'oracle_epm_fccs_wait_for_job':
        return await executeToolOperationImplementation(executeFccsWaitForJobOperation, request)
      case 'oracle_epm_fccs_get_job_details':
        return await executeToolOperationImplementation(executeFccsGetJobDetailsOperation, request)
      case 'oracle_epm_fccs_get_child_job_details':
        return await executeToolOperationImplementation(
          executeFccsGetChildJobDetailsOperation,
          request
        )
      case 'oracle_epm_fccs_export_job_console':
        return await executeToolOperationImplementation(
          executeFccsExportJobConsoleOperation,
          request
        )
      case 'oracle_epm_fccs_export_data_slice':
        return await executeToolOperationImplementation(
          executeFccsExportDataSliceOperation,
          request
        )
      case 'oracle_epm_fccs_import_data_slice':
        return await executeToolOperationImplementation(
          executeFccsImportDataSliceOperation,
          request
        )
      case 'oracle_epm_fccs_clear_data_slice':
        return await executeToolOperationImplementation(executeFccsClearDataSliceOperation, request)
      case 'oracle_epm_fccs_clear_data_profile':
        return await executeToolOperationImplementation(
          executeFccsClearDataProfileOperation,
          request
        )
      case 'oracle_epm_fccs_copy_data_profile':
        return await executeToolOperationImplementation(
          executeFccsCopyDataProfileOperation,
          request
        )
      case 'oracle_epm_fccs_export_application_data':
        return await executeToolOperationImplementation(
          executeFccsExportApplicationDataOperation,
          request
        )
      case 'oracle_epm_fccs_import_application_data':
        return await executeToolOperationImplementation(
          executeFccsImportApplicationDataOperation,
          request
        )
      case 'oracle_epm_fccs_import_exchange_rates':
        return await executeToolOperationImplementation(
          executeFccsImportExchangeRatesOperation,
          request
        )
      case 'oracle_epm_fccs_export_metadata':
        return await executeToolOperationImplementation(executeFccsExportMetadataOperation, request)
      case 'oracle_epm_fccs_import_metadata':
        return await executeToolOperationImplementation(executeFccsImportMetadataOperation, request)
      case 'oracle_epm_fccs_list_journals':
        return await executeToolOperationImplementation(executeFccsListJournalsOperation, request)
      case 'oracle_epm_fccs_perform_journal_action':
        return await executeToolOperationImplementation(
          executeFccsPerformJournalActionOperation,
          request
        )
      case 'oracle_epm_fccs_update_journal_period':
        return await executeToolOperationImplementation(
          executeFccsUpdateJournalPeriodOperation,
          request
        )
      case 'oracle_epm_fccs_export_journals':
        return await executeToolOperationImplementation(executeFccsExportJournalsOperation, request)
      case 'oracle_epm_fccs_import_journals':
        return await executeToolOperationImplementation(executeFccsImportJournalsOperation, request)
      case 'oracle_epm_fccs_generate_intercompany_report':
        return await executeToolOperationImplementation(
          executeFccsGenerateIntercompanyReportOperation,
          request
        )
      case 'oracle_epm_fccs_export_consolidation_rulesets':
        return await executeToolOperationImplementation(
          executeFccsExportConsolidationRulesetsOperation,
          request
        )
      case 'oracle_epm_fccs_import_consolidation_rulesets':
        return await executeToolOperationImplementation(
          executeFccsImportConsolidationRulesetsOperation,
          request
        )
      case 'oracle_epm_fccs_list_files':
        return await executeToolOperationImplementation(executeFccsListFilesOperation, request)
      case 'oracle_epm_fccs_upload_file':
        return await executeToolOperationImplementation(executeFccsUploadFileOperation, request)
      case 'oracle_epm_fccs_download_file':
        return await executeToolOperationImplementation(executeFccsDownloadFileOperation, request)
      case 'oracle_epm_fccs_delete_file':
        return await executeToolOperationImplementation(executeFccsDeleteFileOperation, request)
      default:
        return Response.json(
          { success: false, error: 'Unsupported Oracle EPM FCCS tool' },
          { status: 400 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    if (
      isPayloadSizeLimitError(error) ||
      (error instanceof OracleEpmError && error.category === 'payload_too_large')
    ) {
      return Response.json(
        {
          success: false,
          error:
            'FCCS payload exceeds the supported size. Sim files are capped at 100 MiB; an Oracle export may already have completed. Retrieve or split oversized exports outside Sim.',
        },
        { status: 413 }
      )
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Oracle EPM FCCS operation failed') },
      {
        status:
          error instanceof OracleEpmError
            ? (error.status ?? errorStatuses[error.category])
            : error instanceof FccsInputError
              ? 400
              : 502,
      }
    )
  }
}
