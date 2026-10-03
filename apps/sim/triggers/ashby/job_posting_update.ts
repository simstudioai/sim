import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildJobPostingUpdateOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyJobPostingUpdateTrigger: TriggerConfig = {
  id: 'ashby_job_posting_update',
  name: 'Ashby Job Posting Updated',
  provider: 'ashby',
  description: 'Trigger workflow when a job posting is updated',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_job_posting_update',
    eventType: 'Job Posting Updated',
  }),
  outputs: buildJobPostingUpdateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
