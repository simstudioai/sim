import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrVerificationProcessedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_verification_processed'
)
