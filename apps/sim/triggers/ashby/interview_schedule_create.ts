import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildInterviewScheduleCreateOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyInterviewScheduleCreateTrigger: TriggerConfig = {
  id: 'ashby_interview_schedule_create',
  name: 'Ashby Interview Schedule Created',
  provider: 'ashby',
  description: 'Trigger workflow when an interview schedule is created',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_interview_schedule_create',
    eventType: 'Interview Schedule Created',
  }),
  outputs: buildInterviewScheduleCreateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
