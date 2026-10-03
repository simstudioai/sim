import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildInterviewScheduleUpdateOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyInterviewScheduleUpdateTrigger: TriggerConfig = {
  id: 'ashby_interview_schedule_update',
  name: 'Ashby Interview Schedule Updated',
  provider: 'ashby',
  description: 'Trigger workflow when an interview schedule is updated',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_interview_schedule_update',
    eventType: 'Interview Schedule Updated',
  }),
  outputs: buildInterviewScheduleUpdateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
