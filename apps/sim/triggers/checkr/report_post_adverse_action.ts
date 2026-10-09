import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportPostAdverseActionTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_post_adverse_action'
)
