import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrInvitationDeletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_deleted'
)
