import type { z } from 'zod'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import {
  executeOracleEpmPlanningAddMember,
  executeOracleEpmPlanningClearDataSlice,
  executeOracleEpmPlanningDeleteFile,
  executeOracleEpmPlanningDeleteSubstitutionVariable,
  executeOracleEpmPlanningDownloadFile,
  executeOracleEpmPlanningExportApplicationData,
  executeOracleEpmPlanningExportDataSlice,
  executeOracleEpmPlanningExportFormData,
  executeOracleEpmPlanningGetDimension,
  executeOracleEpmPlanningGetJob,
  executeOracleEpmPlanningGetJobDetails,
  executeOracleEpmPlanningGetMember,
  executeOracleEpmPlanningGetSubstitutionVariable,
  executeOracleEpmPlanningImportApplicationData,
  executeOracleEpmPlanningImportDataSlice,
  executeOracleEpmPlanningListApplications,
  executeOracleEpmPlanningListCubes,
  executeOracleEpmPlanningListDimensions,
  executeOracleEpmPlanningListFiles,
  executeOracleEpmPlanningListJobDefinitions,
  executeOracleEpmPlanningListSubstitutionVariables,
  executeOracleEpmPlanningRefreshCube,
  executeOracleEpmPlanningRunJob,
  executeOracleEpmPlanningRunRule,
  executeOracleEpmPlanningRunRuleset,
  executeOracleEpmPlanningSetAdministrationMode,
  executeOracleEpmPlanningSetSubstitutionVariables,
  executeOracleEpmPlanningUploadFile,
  executeOracleEpmPlanningWaitForJob,
} from '@/lib/internal/oracle-epm-planning/operations'
import {
  assertPlanningPayload,
  PlanningContractError,
  PlanningInputError,
  type PlanningOperationContext,
  planningAddMemberInputSchema,
  planningClearDataSliceInputSchema,
  planningDeleteFileInputSchema,
  planningDeleteSubstitutionVariableInputSchema,
  planningDownloadFileInputSchema,
  planningExportApplicationDataInputSchema,
  planningExportDataSliceInputSchema,
  planningExportFormDataInputSchema,
  planningGetDimensionInputSchema,
  planningGetJobDetailsInputSchema,
  planningGetJobInputSchema,
  planningGetMemberInputSchema,
  planningGetSubstitutionVariableInputSchema,
  planningImportApplicationDataInputSchema,
  planningImportDataSliceInputSchema,
  planningListApplicationsInputSchema,
  planningListCubesInputSchema,
  planningListDimensionsInputSchema,
  planningListFilesInputSchema,
  planningListJobDefinitionsInputSchema,
  planningListSubstitutionVariablesInputSchema,
  planningRefreshCubeInputSchema,
  planningRunJobInputSchema,
  planningRunRuleInputSchema,
  planningRunRulesetInputSchema,
  planningSetAdministrationModeInputSchema,
  planningSetSubstitutionVariablesInputSchema,
  planningUploadFileInputSchema,
  planningWaitForJobInputSchema,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import type { OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

async function executeParsed<S extends z.ZodType<{ accessToken: string; instanceUrl: string }>>(
  request: InternalToolOperationCall,
  schema: S,
  operation: (
    input: z.output<S>,
    context: PlanningOperationContext
  ) => Promise<OracleEpmPlanningResponse>
): Promise<Response> {
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error:
          'Invalid Oracle EPM Planning inputs; check the required fields and their documented formats',
        output: {},
      },
      { status: 400 }
    )
  }
  const result = await operation(parsed.data, {
    client: createOracleEpmClient(parsed.data),
    signal: request.signal,
    runtime: request.context,
  })
  return Response.json(result)
}

/** In-process product boundary; resolved credential material never goes through self-HTTP. */
export const executeOracleEpmPlanningTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  try {
    assertPlanningPayload(request.input)
    switch (request.toolId) {
      case 'oracle_epm_planning_list_applications':
        return await executeParsed(
          request,
          planningListApplicationsInputSchema,
          executeOracleEpmPlanningListApplications
        )
      case 'oracle_epm_planning_list_cubes':
        return await executeParsed(
          request,
          planningListCubesInputSchema,
          executeOracleEpmPlanningListCubes
        )
      case 'oracle_epm_planning_list_dimensions':
        return await executeParsed(
          request,
          planningListDimensionsInputSchema,
          executeOracleEpmPlanningListDimensions
        )
      case 'oracle_epm_planning_get_dimension':
        return await executeParsed(
          request,
          planningGetDimensionInputSchema,
          executeOracleEpmPlanningGetDimension
        )
      case 'oracle_epm_planning_get_member':
        return await executeParsed(
          request,
          planningGetMemberInputSchema,
          executeOracleEpmPlanningGetMember
        )
      case 'oracle_epm_planning_add_member':
        return await executeParsed(
          request,
          planningAddMemberInputSchema,
          executeOracleEpmPlanningAddMember
        )
      case 'oracle_epm_planning_list_substitution_variables':
        return await executeParsed(
          request,
          planningListSubstitutionVariablesInputSchema,
          executeOracleEpmPlanningListSubstitutionVariables
        )
      case 'oracle_epm_planning_get_substitution_variable':
        return await executeParsed(
          request,
          planningGetSubstitutionVariableInputSchema,
          executeOracleEpmPlanningGetSubstitutionVariable
        )
      case 'oracle_epm_planning_set_substitution_variables':
        return await executeParsed(
          request,
          planningSetSubstitutionVariablesInputSchema,
          executeOracleEpmPlanningSetSubstitutionVariables
        )
      case 'oracle_epm_planning_delete_substitution_variable':
        return await executeParsed(
          request,
          planningDeleteSubstitutionVariableInputSchema,
          executeOracleEpmPlanningDeleteSubstitutionVariable
        )
      case 'oracle_epm_planning_list_job_definitions':
        return await executeParsed(
          request,
          planningListJobDefinitionsInputSchema,
          executeOracleEpmPlanningListJobDefinitions
        )
      case 'oracle_epm_planning_run_job':
        return await executeParsed(
          request,
          planningRunJobInputSchema,
          executeOracleEpmPlanningRunJob
        )
      case 'oracle_epm_planning_run_rule':
        return await executeParsed(
          request,
          planningRunRuleInputSchema,
          executeOracleEpmPlanningRunRule
        )
      case 'oracle_epm_planning_run_ruleset':
        return await executeParsed(
          request,
          planningRunRulesetInputSchema,
          executeOracleEpmPlanningRunRuleset
        )
      case 'oracle_epm_planning_get_job':
        return await executeParsed(
          request,
          planningGetJobInputSchema,
          executeOracleEpmPlanningGetJob
        )
      case 'oracle_epm_planning_wait_for_job':
        return await executeParsed(
          request,
          planningWaitForJobInputSchema,
          executeOracleEpmPlanningWaitForJob
        )
      case 'oracle_epm_planning_get_job_details':
        return await executeParsed(
          request,
          planningGetJobDetailsInputSchema,
          executeOracleEpmPlanningGetJobDetails
        )
      case 'oracle_epm_planning_export_data_slice':
        return await executeParsed(
          request,
          planningExportDataSliceInputSchema,
          executeOracleEpmPlanningExportDataSlice
        )
      case 'oracle_epm_planning_import_data_slice':
        return await executeParsed(
          request,
          planningImportDataSliceInputSchema,
          executeOracleEpmPlanningImportDataSlice
        )
      case 'oracle_epm_planning_clear_data_slice':
        return await executeParsed(
          request,
          planningClearDataSliceInputSchema,
          executeOracleEpmPlanningClearDataSlice
        )
      case 'oracle_epm_planning_export_form_data':
        return await executeParsed(
          request,
          planningExportFormDataInputSchema,
          executeOracleEpmPlanningExportFormData
        )
      case 'oracle_epm_planning_export_application_data':
        return await executeParsed(
          request,
          planningExportApplicationDataInputSchema,
          executeOracleEpmPlanningExportApplicationData
        )
      case 'oracle_epm_planning_import_application_data':
        return await executeParsed(
          request,
          planningImportApplicationDataInputSchema,
          executeOracleEpmPlanningImportApplicationData
        )
      case 'oracle_epm_planning_list_files':
        return await executeParsed(
          request,
          planningListFilesInputSchema,
          executeOracleEpmPlanningListFiles
        )
      case 'oracle_epm_planning_upload_file':
        return await executeParsed(
          request,
          planningUploadFileInputSchema,
          executeOracleEpmPlanningUploadFile
        )
      case 'oracle_epm_planning_download_file':
        return await executeParsed(
          request,
          planningDownloadFileInputSchema,
          executeOracleEpmPlanningDownloadFile
        )
      case 'oracle_epm_planning_delete_file':
        return await executeParsed(
          request,
          planningDeleteFileInputSchema,
          executeOracleEpmPlanningDeleteFile
        )
      case 'oracle_epm_planning_refresh_cube':
        return await executeParsed(
          request,
          planningRefreshCubeInputSchema,
          executeOracleEpmPlanningRefreshCube
        )
      case 'oracle_epm_planning_set_administration_mode':
        return await executeParsed(
          request,
          planningSetAdministrationModeInputSchema,
          executeOracleEpmPlanningSetAdministrationMode
        )
      default:
        return Response.json(
          { success: false, error: 'Unsupported Oracle EPM Planning operation', output: {} },
          { status: 400 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    const safeMessage =
      error instanceof OracleEpmError ||
      error instanceof PlanningInputError ||
      error instanceof PlanningContractError
        ? error.message
        : error instanceof DOMException && error.name === 'TimeoutError'
          ? 'Oracle EPM Planning operation timed out'
          : 'Oracle EPM Planning operation failed'
    const status =
      error instanceof PlanningInputError
        ? 400
        : error instanceof OracleEpmError
          ? (error.status ?? (error.category === 'payload_too_large' ? 413 : 502))
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 408
            : 502
    return Response.json({ success: false, error: safeMessage, output: {} }, { status })
  }
}
