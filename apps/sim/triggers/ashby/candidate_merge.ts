import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildCandidateMergeOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyCandidateMergeTrigger: TriggerConfig = {
  id: 'ashby_candidate_merge',
  name: 'Ashby Candidate Merged',
  provider: 'ashby',
  description: 'Trigger workflow when two candidate records are merged',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_candidate_merge',
    eventType: 'Candidate Merged',
  }),
  outputs: buildCandidateMergeOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
