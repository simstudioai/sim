import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportCreatedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_created')
