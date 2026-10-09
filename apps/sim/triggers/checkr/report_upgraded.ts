import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportUpgradedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_upgraded')
