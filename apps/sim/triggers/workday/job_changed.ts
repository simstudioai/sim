import { WorkdayIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildJobChangedOutputs, buildWorkdaySubBlocks } from '@/triggers/workday/utils'

export const workdayJobChangedTrigger: TriggerConfig = {
  id: 'workday_job_changed',
  name: 'Workday Job Changed',
  provider: 'workday',
  description:
    'Trigger workflow when a job change occurs in Workday (transfer, promotion, demotion)',
  version: '1.0.0',
  icon: WorkdayIcon,

  subBlocks: buildWorkdaySubBlocks({
    triggerId: 'workday_job_changed',
    eventType: 'Change Job',
  }),

  outputs: buildJobChangedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
    },
  },
}
