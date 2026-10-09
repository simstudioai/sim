import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrInvitationCreatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_created'
)
