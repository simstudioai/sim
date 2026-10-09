import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrCandidateCreatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_candidate_created'
)
