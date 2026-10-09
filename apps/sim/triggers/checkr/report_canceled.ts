import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportCanceledTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_canceled')
