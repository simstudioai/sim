import { WorkdayIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildEmployeeTerminatedOutputs, buildWorkdaySubBlocks } from '@/triggers/workday/utils'

export const workdayEmployeeTerminatedTrigger: TriggerConfig = {
  id: 'workday_employee_terminated',
  name: 'Workday Employee Terminated',
  provider: 'workday',
  description: 'Trigger workflow when an employee is terminated in Workday',
  version: '1.0.0',
  icon: WorkdayIcon,

  subBlocks: buildWorkdaySubBlocks({
    triggerId: 'workday_employee_terminated',
    eventType: 'Terminate Employee',
  }),

  outputs: buildEmployeeTerminatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
    },
  },
}
