import { assignOnboardingTool } from '@/tools/workday/assign_onboarding'
import { changeJobTool } from '@/tools/workday/change_job'
import { createPrehireTool } from '@/tools/workday/create_prehire'
import { getCompensationTool } from '@/tools/workday/get_compensation'
import { getOrganizationsTool } from '@/tools/workday/get_organizations'
import { getWorkerTool } from '@/tools/workday/get_worker'
import { hireEmployeeTool } from '@/tools/workday/hire_employee'
import { listWorkersTool } from '@/tools/workday/list_workers'
import { terminateWorkerTool } from '@/tools/workday/terminate_worker'
import { updateWorkerTool } from '@/tools/workday/update_worker'

export {
  assignOnboardingTool as workdayAssignOnboardingTool,
  changeJobTool as workdayChangeJobTool,
  createPrehireTool as workdayCreatePrehireTool,
  getCompensationTool as workdayGetCompensationTool,
  getOrganizationsTool as workdayGetOrganizationsTool,
  getWorkerTool as workdayGetWorkerTool,
  hireEmployeeTool as workdayHireEmployeeTool,
  listWorkersTool as workdayListWorkersTool,
  terminateWorkerTool as workdayTerminateWorkerTool,
  updateWorkerTool as workdayUpdateWorkerTool,
}

export * from './types'
