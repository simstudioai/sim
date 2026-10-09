import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrReportPausedTrigger: TriggerConfig = createCheckrTrigger('checkr_report_paused')
