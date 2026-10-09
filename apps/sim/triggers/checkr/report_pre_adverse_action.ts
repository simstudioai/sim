import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportPreAdverseActionTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_pre_adverse_action'
)
