import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrAdverseActionNoticeNotDeliveredTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_notice_not_delivered'
)
