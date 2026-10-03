import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildJobUpdateOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyJobUpdateTrigger: TriggerConfig = {
  id: 'ashby_job_update',
  name: 'Ashby Job Updated',
  provider: 'ashby',
  description: 'Trigger workflow when a job is updated',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({ triggerId: 'ashby_job_update', eventType: 'Job Updated' }),
  outputs: buildJobUpdateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
