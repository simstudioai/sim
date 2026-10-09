import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportEngagedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_engaged')
