import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrInvitationCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_completed'
)
