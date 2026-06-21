import { PagerDutyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPagerDutyExtraFields,
  buildPagerDutyIncidentOutputs,
  pagerdutySetupInstructions,
  pagerdutyTriggerOptions,
} from '@/triggers/pagerduty/utils'
import type { TriggerConfig } from '@/triggers/types'

export const pagerdutyIncidentEscalatedTrigger: TriggerConfig = {
  id: 'pagerduty_incident_escalated',
  name: 'PagerDuty Incident Escalated',
  provider: 'pagerduty',
  description: 'Trigger workflow when an incident is escalated in PagerDuty',
  version: '1.0.0',
  icon: PagerDutyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'pagerduty_incident_escalated',
    triggerOptions: pagerdutyTriggerOptions,
    setupInstructions: pagerdutySetupInstructions('Incident Escalated'),
    extraFields: buildPagerDutyExtraFields('pagerduty_incident_escalated'),
  }),
  outputs: buildPagerDutyIncidentOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PagerDuty-Signature': 'v1=...',
    },
  },
}
