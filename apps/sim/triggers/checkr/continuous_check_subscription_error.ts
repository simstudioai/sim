import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrContinuousCheckSubscriptionErrorTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_continuous_check_subscription_error'
)
