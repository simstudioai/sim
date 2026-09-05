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
  signal?: AbortSignal
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
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      return Response.json({ success: false, error: error.message }, { status: error.status })
    }
    return Response.json(
      { success: false, error: 'Oracle Fusion HCM request failed' },
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
    default:
      return Response.json(
        { success: false, error: `Unsupported Oracle Fusion HCM tool: ${toolId}` },
        { status: 500 }
      )
  }
}
