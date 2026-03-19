import { WorkdayIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildEmployeeHiredOutputs, buildWorkdaySubBlocks } from '@/triggers/workday/utils'

export const workdayEmployeeHiredTrigger: TriggerConfig = {
  id: 'workday_employee_hired',
  name: 'Workday Employee Hired',
  provider: 'workday',
  description: 'Trigger workflow when an employee is hired in Workday',
  version: '1.0.0',
  icon: WorkdayIcon,

  subBlocks: buildWorkdaySubBlocks({
    triggerId: 'workday_employee_hired',
    eventType: 'Hire Employee',
    includeDropdown: true,
  }),

  outputs: buildEmployeeHiredOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
    },
  },
}
