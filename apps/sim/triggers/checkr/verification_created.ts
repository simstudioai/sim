import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrVerificationCreatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_verification_created'
)
