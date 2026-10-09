import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrCandidateUpdatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_candidate_updated'
)
