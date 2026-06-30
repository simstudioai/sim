import { PagerDutyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPagerDutyExtraFields,
  buildPagerDutyIncidentOutputs,
  pagerdutySetupInstructions,
  pagerdutyTriggerOptions,
} from '@/triggers/pagerduty/utils'
import type { TriggerConfig } from '@/triggers/types'

export const pagerdutyIncidentResolvedTrigger: TriggerConfig = {
  id: 'pagerduty_incident_resolved',
  name: 'PagerDuty Incident Resolved',
  provider: 'pagerduty',
  description: 'Trigger workflow when an incident is resolved in PagerDuty',
  version: '1.0.0',
  icon: PagerDutyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'pagerduty_incident_resolved',
    triggerOptions: pagerdutyTriggerOptions,
    setupInstructions: pagerdutySetupInstructions('Incident Resolved'),
    extraFields: buildPagerDutyExtraFields('pagerduty_incident_resolved'),
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
