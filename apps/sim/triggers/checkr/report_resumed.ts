import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportResumedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_resumed')
