import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrAdverseActionPausedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_paused'
)
