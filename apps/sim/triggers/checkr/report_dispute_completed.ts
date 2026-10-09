import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportDisputeCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_dispute_completed'
)
