import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrAdverseActionCanceledTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_canceled'
)
