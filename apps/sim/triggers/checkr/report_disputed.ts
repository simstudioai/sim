import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportDisputedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_disputed')
