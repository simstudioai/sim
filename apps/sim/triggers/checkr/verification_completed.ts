import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrVerificationCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_verification_completed'
)
