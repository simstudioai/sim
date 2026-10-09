import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrContinuousCheckConfirmationRequiredTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_continuous_check_confirmation_required'
)
