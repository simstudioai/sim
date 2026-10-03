import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  workdayAssignOnboardingContract,
  workdayChangeJobContract,
  workdayCreatePrehireContract,
  workdayGetCompensationContract,
  workdayGetOrganizationsContract,
  workdayGetWorkerContract,
  workdayHireContract,
  workdayListWorkersContract,
  workdayTerminateContract,
  workdayUpdateWorkerContract,
} from '@/lib/api/contracts/tools/workday'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { WorkdayOperationError } from '@/lib/internal/workday/errors'
import {
  executeWorkdayAssignOnboarding,
  executeWorkdayChangeJob,
  executeWorkdayCreatePrehire,
  executeWorkdayGetCompensation,
  executeWorkdayGetOrganizations,
  executeWorkdayGetWorker,
  executeWorkdayHire,
  executeWorkdayListWorkers,
  executeWorkdayTerminate,
  executeWorkdayUpdateWorker,
} from '@/lib/internal/workday/operations'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof WorkdayOperationError) {
      return Response.json({ success: false, error: error.message }, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
}

export const executeWorkdayTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'workday_assign_onboarding':
      return executeOperation(
        workdayAssignOnboardingContract,
        input,
        executeWorkdayAssignOnboarding,
        signal
      )
    case 'workday_change_job':
      return executeOperation(workdayChangeJobContract, input, executeWorkdayChangeJob, signal)
    case 'workday_create_prehire':
      return executeOperation(
        workdayCreatePrehireContract,
        input,
        executeWorkdayCreatePrehire,
        signal
      )
    case 'workday_get_compensation':
      return executeOperation(
        workdayGetCompensationContract,
        input,
        executeWorkdayGetCompensation,
        signal
      )
    case 'workday_get_organizations':
      return executeOperation(
        workdayGetOrganizationsContract,
        input,
        executeWorkdayGetOrganizations,
        signal
      )
    case 'workday_get_worker':
      return executeOperation(workdayGetWorkerContract, input, executeWorkdayGetWorker, signal)
    case 'workday_hire_employee':
      return executeOperation(workdayHireContract, input, executeWorkdayHire, signal)
    case 'workday_list_workers':
      return executeOperation(workdayListWorkersContract, input, executeWorkdayListWorkers, signal)
    case 'workday_terminate_worker':
      return executeOperation(workdayTerminateContract, input, executeWorkdayTerminate, signal)
    case 'workday_update_worker':
      return executeOperation(
        workdayUpdateWorkerContract,
        input,
        executeWorkdayUpdateWorker,
        signal
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported Workday tool: ${toolId}` },
        { status: 500 }
      )
  }
}
