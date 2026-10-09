import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportSuspendedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_suspended')
