import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

/** Primary Checkr trigger: carries the trigger-type dropdown for every Checkr event. */
export const checkrReportCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_completed',
  { includeDropdown: true }
)
