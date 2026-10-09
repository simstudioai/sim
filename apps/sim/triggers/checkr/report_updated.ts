import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportUpdatedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_updated')
