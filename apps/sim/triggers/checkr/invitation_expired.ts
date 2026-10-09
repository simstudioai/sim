import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrInvitationExpiredTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_expired'
)
