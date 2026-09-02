import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildJobPostingDeleteOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyJobPostingDeleteTrigger: TriggerConfig = {
  id: 'ashby_job_posting_delete',
  name: 'Ashby Job Posting Deleted',
  provider: 'ashby',
  description: 'Trigger workflow when a job posting is deleted',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_job_posting_delete',
    eventType: 'Job Posting Deleted',
  }),
  outputs: buildJobPostingDeleteOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
