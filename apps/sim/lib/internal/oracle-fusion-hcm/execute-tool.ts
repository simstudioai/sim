import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import * as operations from '@/lib/internal/oracle-fusion-hcm/operations'
import * as schemas from '@/lib/internal/oracle-fusion-hcm/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<S extends z.ZodType>(
  schema: S,
  input: unknown,
  execute: (input: z.output<S>, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
  mutation = false
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid Oracle Fusion HCM request'),
      },
      { status: 400 }
    )
  }
  try {
    const result = await execute(parsed.data, signal)
    if (!mutation) signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      return Response.json({ success: false, error: error.message, ...(mutation ? { retryable: false } : {}) }, { status: error.status })
    }
    return Response.json(
      { success: false, error: 'Oracle Fusion HCM request failed', ...(mutation ? { retryable: false } : {}) },
      { status: 500 }
    )
  }
}

export const executeOracleFusionHcmTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  switch (toolId) {
    case 'oracle_fusion_hcm_list_workers':
      return executeOperation(
        schemas.oracleFusionHcmListWorkersBodySchema,
        input,
        operations.executeOracleFusionHcmListWorkers,
        signal
      )
    case 'oracle_fusion_hcm_get_worker':
      return executeOperation(
        schemas.oracleFusionHcmGetWorkerBodySchema,
        input,
        operations.executeOracleFusionHcmGetWorker,
        signal
      )
    case 'oracle_fusion_hcm_list_worker_assignments':
      return executeOperation(
        schemas.oracleFusionHcmListWorkerAssignmentsBodySchema,
        input,
        operations.executeOracleFusionHcmListWorkerAssignments,
        signal
      )
    case 'oracle_fusion_hcm_get_worker_assignment':
      return executeOperation(
        schemas.oracleFusionHcmGetWorkerAssignmentBodySchema,
        input,
        operations.executeOracleFusionHcmGetWorkerAssignment,
        signal
      )
    case 'oracle_fusion_hcm_list_worker_managers':
      return executeOperation(
        schemas.oracleFusionHcmListWorkerManagersBodySchema,
        input,
        operations.executeOracleFusionHcmListWorkerManagers,
        signal
      )
    case 'oracle_fusion_hcm_list_worker_direct_reports':
      return executeOperation(
        schemas.oracleFusionHcmListWorkerDirectReportsBodySchema,
        input,
        operations.executeOracleFusionHcmListWorkerDirectReports,
        signal
      )
    case 'oracle_fusion_hcm_list_absences':
      return executeOperation(
        schemas.oracleFusionHcmListAbsencesBodySchema,
        input,
        operations.executeOracleFusionHcmListAbsences,
        signal
      )
    case 'oracle_fusion_hcm_get_absence':
      return executeOperation(
        schemas.oracleFusionHcmGetAbsenceBodySchema,
        input,
        operations.executeOracleFusionHcmGetAbsence,
        signal
      )
    case 'oracle_fusion_hcm_list_absence_types':
      return executeOperation(
        schemas.oracleFusionHcmListAbsenceTypesBodySchema,
        input,
        operations.executeOracleFusionHcmListAbsenceTypes,
        signal
      )
    case 'oracle_fusion_hcm_list_jobs':
      return executeOperation(
        schemas.oracleFusionHcmListJobsBodySchema,
        input,
        operations.executeOracleFusionHcmListJobs,
        signal
      )
    case 'oracle_fusion_hcm_list_job_families':
      return executeOperation(
        schemas.oracleFusionHcmListJobFamiliesBodySchema,
        input,
        operations.executeOracleFusionHcmListJobFamilies,
        signal
      )
    case 'oracle_fusion_hcm_list_departments':
      return executeOperation(
        schemas.oracleFusionHcmListDepartmentsBodySchema,
        input,
        operations.executeOracleFusionHcmListDepartments,
        signal
      )
    case 'oracle_fusion_hcm_list_locations':
      return executeOperation(
        schemas.oracleFusionHcmListLocationsBodySchema,
        input,
        operations.executeOracleFusionHcmListLocations,
        signal
      )
    case 'oracle_fusion_hcm_list_positions':
      return executeOperation(
        schemas.oracleFusionHcmListPositionsBodySchema,
        input,
        operations.executeOracleFusionHcmListPositions,
        signal
      )
    case 'oracle_fusion_hcm_list_business_units':
      return executeOperation(
        schemas.oracleFusionHcmListBusinessUnitsBodySchema,
        input,
        operations.executeOracleFusionHcmListBusinessUnits,
        signal
      )
    case 'oracle_fusion_hcm_list_legal_employers':
      return executeOperation(
        schemas.oracleFusionHcmListLegalEmployersBodySchema,
        input,
        operations.executeOracleFusionHcmListLegalEmployers,
        signal
      )
    case 'oracle_fusion_hcm_list_grades':
      return executeOperation(
        schemas.oracleFusionHcmListGradesBodySchema,
        input,
        operations.executeOracleFusionHcmListGrades,
        signal
      )
    case 'oracle_fusion_hcm_list_person_types':
      return executeOperation(
        schemas.oracleFusionHcmListPersonTypesBodySchema,
        input,
        operations.executeOracleFusionHcmListPersonTypes,
        signal
      )
    case 'oracle_fusion_hcm_list_payroll_relationships':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollRelationshipsBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollRelationships,
        signal
      )
    case 'oracle_fusion_hcm_get_payroll_relationship':
      return executeOperation(
        schemas.oracleFusionHcmGetPayrollRelationshipBodySchema,
        input,
        operations.executeOracleFusionHcmGetPayrollRelationship,
        signal
      )
    case 'oracle_fusion_hcm_list_payroll_assignments':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollAssignmentsBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollAssignments,
        signal
      )
    case 'oracle_fusion_hcm_get_payroll_assignment':
      return executeOperation(
        schemas.oracleFusionHcmGetPayrollAssignmentBodySchema,
        input,
        operations.executeOracleFusionHcmGetPayrollAssignment,
        signal
      )
    case 'oracle_fusion_hcm_list_assigned_payrolls':
      return executeOperation(
        schemas.oracleFusionHcmListAssignedPayrollsBodySchema,
        input,
        operations.executeOracleFusionHcmListAssignedPayrolls,
        signal
      )
    case 'oracle_fusion_hcm_get_assigned_payroll':
      return executeOperation(
        schemas.oracleFusionHcmGetAssignedPayrollBodySchema,
        input,
        operations.executeOracleFusionHcmGetAssignedPayroll,
        signal
      )
    case 'oracle_fusion_hcm_create_assigned_payroll':
      return executeOperation(
        schemas.oracleFusionHcmCreateAssignedPayrollBodySchema,
        input,
        operations.executeOracleFusionHcmCreateAssignedPayroll,
        signal,
        true
      )
    case 'oracle_fusion_hcm_update_assigned_payroll':
      return executeOperation(
        schemas.oracleFusionHcmUpdateAssignedPayrollBodySchema,
        input,
        operations.executeOracleFusionHcmUpdateAssignedPayroll,
        signal,
        true
      )
    case 'oracle_fusion_hcm_list_payroll_definitions':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollDefinitionsBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollDefinitions,
        signal
      )
    case 'oracle_fusion_hcm_list_payroll_time_periods':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollTimePeriodsBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollTimePeriods,
        signal
      )
    case 'oracle_fusion_hcm_list_payroll_element_definitions':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollElementDefinitionsBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollElementDefinitions,
        signal
      )
    case 'oracle_fusion_hcm_list_payroll_input_values':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollInputValuesBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollInputValues,
        signal
      )
    case 'oracle_fusion_hcm_list_element_entries':
      return executeOperation(
        schemas.oracleFusionHcmListElementEntriesBodySchema,
        input,
        operations.executeOracleFusionHcmListElementEntries,
        signal
      )
    case 'oracle_fusion_hcm_get_element_entry':
      return executeOperation(
        schemas.oracleFusionHcmGetElementEntryBodySchema,
        input,
        operations.executeOracleFusionHcmGetElementEntry,
        signal
      )
    case 'oracle_fusion_hcm_list_element_entry_values':
      return executeOperation(
        schemas.oracleFusionHcmListElementEntryValuesBodySchema,
        input,
        operations.executeOracleFusionHcmListElementEntryValues,
        signal
      )
    case 'oracle_fusion_hcm_create_element_entry':
      return executeOperation(
        schemas.oracleFusionHcmCreateElementEntryBodySchema,
        input,
        operations.executeOracleFusionHcmCreateElementEntry,
        signal,
        true
      )
    case 'oracle_fusion_hcm_update_element_entry_value':
      return executeOperation(
        schemas.oracleFusionHcmUpdateElementEntryValueBodySchema,
        input,
        operations.executeOracleFusionHcmUpdateElementEntryValue,
        signal,
        true
      )
    case 'oracle_fusion_hcm_list_person_process_results':
      return executeOperation(
        schemas.oracleFusionHcmListPersonProcessResultsBodySchema,
        input,
        operations.executeOracleFusionHcmListPersonProcessResults,
        signal
      )
    case 'oracle_fusion_hcm_get_person_process_result':
      return executeOperation(
        schemas.oracleFusionHcmGetPersonProcessResultBodySchema,
        input,
        operations.executeOracleFusionHcmGetPersonProcessResult,
        signal
      )
    case 'oracle_fusion_hcm_list_payroll_run_results':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollRunResultsBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollRunResults,
        signal
      )
    case 'oracle_fusion_hcm_list_payroll_balances':
      return executeOperation(
        schemas.oracleFusionHcmListPayrollBalancesBodySchema,
        input,
        operations.executeOracleFusionHcmListPayrollBalances,
        signal
      )
    case 'oracle_fusion_hcm_list_salaries':
      return executeOperation(
        schemas.oracleFusionHcmListSalariesBodySchema,
        input,
        operations.executeOracleFusionHcmListSalaries,
        signal
      )
    case 'oracle_fusion_hcm_get_salary':
      return executeOperation(
        schemas.oracleFusionHcmGetSalaryBodySchema,
        input,
        operations.executeOracleFusionHcmGetSalary,
        signal
      )
    case 'oracle_fusion_hcm_create_salary':
      return executeOperation(
        schemas.oracleFusionHcmCreateSalaryBodySchema,
        input,
        operations.executeOracleFusionHcmCreateSalary,
        signal,
        true
      )
    case 'oracle_fusion_hcm_correct_salary':
      return executeOperation(
        schemas.oracleFusionHcmCorrectSalaryBodySchema,
        input,
        operations.executeOracleFusionHcmCorrectSalary,
        signal,
        true
      )
    case 'oracle_fusion_hcm_list_salary_bases':
      return executeOperation(
        schemas.oracleFusionHcmListSalaryBasesBodySchema,
        input,
        operations.executeOracleFusionHcmListSalaryBases,
        signal
      )
    case 'oracle_fusion_hcm_list_salary_components':
      return executeOperation(
        schemas.oracleFusionHcmListSalaryComponentsBodySchema,
        input,
        operations.executeOracleFusionHcmListSalaryComponents,
        signal
      )
    case 'oracle_fusion_hcm_list_grade_rate_values':
      return executeOperation(
        schemas.oracleFusionHcmListGradeRateValuesBodySchema,
        input,
        operations.executeOracleFusionHcmListGradeRateValues,
        signal
      )
    case 'oracle_fusion_hcm_list_goal_plans':
      return executeOperation(
        schemas.oracleFusionHcmListGoalPlansBodySchema,
        input,
        operations.executeOracleFusionHcmListGoalPlans,
        signal
      )
    case 'oracle_fusion_hcm_get_goal_plan':
      return executeOperation(
        schemas.oracleFusionHcmGetGoalPlanBodySchema,
        input,
        operations.executeOracleFusionHcmGetGoalPlan,
        signal
      )
    case 'oracle_fusion_hcm_list_performance_goals':
      return executeOperation(
        schemas.oracleFusionHcmListPerformanceGoalsBodySchema,
        input,
        operations.executeOracleFusionHcmListPerformanceGoals,
        signal
      )
    case 'oracle_fusion_hcm_get_performance_goal':
      return executeOperation(
        schemas.oracleFusionHcmGetPerformanceGoalBodySchema,
        input,
        operations.executeOracleFusionHcmGetPerformanceGoal,
        signal
      )
    case 'oracle_fusion_hcm_list_development_goals':
      return executeOperation(
        schemas.oracleFusionHcmListDevelopmentGoalsBodySchema,
        input,
        operations.executeOracleFusionHcmListDevelopmentGoals,
        signal
      )
    case 'oracle_fusion_hcm_get_development_goal':
      return executeOperation(
        schemas.oracleFusionHcmGetDevelopmentGoalBodySchema,
        input,
        operations.executeOracleFusionHcmGetDevelopmentGoal,
        signal
      )
    case 'oracle_fusion_hcm_list_performance_documents':
      return executeOperation(
        schemas.oracleFusionHcmListPerformanceDocumentsBodySchema,
        input,
        operations.executeOracleFusionHcmListPerformanceDocuments,
        signal
      )
    case 'oracle_fusion_hcm_get_performance_document':
      return executeOperation(
        schemas.oracleFusionHcmGetPerformanceDocumentBodySchema,
        input,
        operations.executeOracleFusionHcmGetPerformanceDocument,
        signal
      )
    case 'oracle_fusion_hcm_list_performance_document_roles':
      return executeOperation(
        schemas.oracleFusionHcmListPerformanceDocumentRolesBodySchema,
        input,
        operations.executeOracleFusionHcmListPerformanceDocumentRoles,
        signal
      )
    case 'oracle_fusion_hcm_list_performance_document_participants':
      return executeOperation(
        schemas.oracleFusionHcmListPerformanceDocumentParticipantsBodySchema,
        input,
        operations.executeOracleFusionHcmListPerformanceDocumentParticipants,
        signal
      )
    case 'oracle_fusion_hcm_list_performance_document_tasks':
      return executeOperation(
        schemas.oracleFusionHcmListPerformanceDocumentTasksBodySchema,
        input,
        operations.executeOracleFusionHcmListPerformanceDocumentTasks,
        signal
      )
    case 'oracle_fusion_hcm_list_talent_profiles':
      return executeOperation(
        schemas.oracleFusionHcmListTalentProfilesBodySchema,
        input,
        operations.executeOracleFusionHcmListTalentProfiles,
        signal
      )
    case 'oracle_fusion_hcm_get_talent_profile':
      return executeOperation(
        schemas.oracleFusionHcmGetTalentProfileBodySchema,
        input,
        operations.executeOracleFusionHcmGetTalentProfile,
        signal
      )
    case 'oracle_fusion_hcm_list_talent_profile_sections':
      return executeOperation(
        schemas.oracleFusionHcmListTalentProfileSectionsBodySchema,
        input,
        operations.executeOracleFusionHcmListTalentProfileSections,
        signal
      )
    case 'oracle_fusion_hcm_list_talent_profile_skills':
      return executeOperation(
        schemas.oracleFusionHcmListTalentProfileSkillsBodySchema,
        input,
        operations.executeOracleFusionHcmListTalentProfileSkills,
        signal
      )
    case 'oracle_fusion_hcm_list_talent_profile_certifications':
      return executeOperation(
        schemas.oracleFusionHcmListTalentProfileCertificationsBodySchema,
        input,
        operations.executeOracleFusionHcmListTalentProfileCertifications,
        signal
      )
    case 'oracle_fusion_hcm_list_time_records':
      return executeOperation(
        schemas.oracleFusionHcmListTimeRecordsBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeRecords,
        signal
      )
    case 'oracle_fusion_hcm_get_time_record':
      return executeOperation(
        schemas.oracleFusionHcmGetTimeRecordBodySchema,
        input,
        operations.executeOracleFusionHcmGetTimeRecord,
        signal
      )
    case 'oracle_fusion_hcm_list_time_cards':
      return executeOperation(
        schemas.oracleFusionHcmListTimeCardsBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeCards,
        signal
      )
    case 'oracle_fusion_hcm_get_time_card':
      return executeOperation(
        schemas.oracleFusionHcmGetTimeCardBodySchema,
        input,
        operations.executeOracleFusionHcmGetTimeCard,
        signal
      )
    case 'oracle_fusion_hcm_list_time_attributes':
      return executeOperation(
        schemas.oracleFusionHcmListTimeAttributesBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeAttributes,
        signal
      )
    case 'oracle_fusion_hcm_list_time_attribute_data_sources':
      return executeOperation(
        schemas.oracleFusionHcmListTimeAttributeDataSourcesBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeAttributeDataSources,
        signal
      )
    case 'oracle_fusion_hcm_list_time_attribute_criteria_binds':
      return executeOperation(
        schemas.oracleFusionHcmListTimeAttributeCriteriaBindsBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeAttributeCriteriaBinds,
        signal
      )
    case 'oracle_fusion_hcm_list_time_attribute_values':
      return executeOperation(
        schemas.oracleFusionHcmListTimeAttributeValuesBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeAttributeValues,
        signal
      )
    case 'oracle_fusion_hcm_create_time_entry':
      return executeOperation(
        schemas.oracleFusionHcmCreateTimeEntryBodySchema,
        input,
        operations.executeOracleFusionHcmCreateTimeEntry,
        signal,
        true
      )
    case 'oracle_fusion_hcm_update_time_entry':
      return executeOperation(
        schemas.oracleFusionHcmUpdateTimeEntryBodySchema,
        input,
        operations.executeOracleFusionHcmUpdateTimeEntry,
        signal,
        true
      )
    case 'oracle_fusion_hcm_delete_time_entry':
      return executeOperation(
        schemas.oracleFusionHcmDeleteTimeEntryBodySchema,
        input,
        operations.executeOracleFusionHcmDeleteTimeEntry,
        signal,
        true
      )
    case 'oracle_fusion_hcm_get_time_record_request':
      return executeOperation(
        schemas.oracleFusionHcmGetTimeRecordRequestBodySchema,
        input,
        operations.executeOracleFusionHcmGetTimeRecordRequest,
        signal
      )
    case 'oracle_fusion_hcm_list_time_record_request_events':
      return executeOperation(
        schemas.oracleFusionHcmListTimeRecordRequestEventsBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeRecordRequestEvents,
        signal
      )
    case 'oracle_fusion_hcm_list_time_record_event_messages':
      return executeOperation(
        schemas.oracleFusionHcmListTimeRecordEventMessagesBodySchema,
        input,
        operations.executeOracleFusionHcmListTimeRecordEventMessages,
        signal
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported Oracle Fusion HCM tool: ${toolId}` },
        { status: 500 }
      )
  }
}
