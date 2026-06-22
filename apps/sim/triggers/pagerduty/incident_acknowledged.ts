import { PagerDutyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPagerDutyExtraFields,
  buildPagerDutyIncidentOutputs,
  pagerdutySetupInstructions,
  pagerdutyTriggerOptions,
} from '@/triggers/pagerduty/utils'
import type { TriggerConfig } from '@/triggers/types'

export const pagerdutyIncidentAcknowledgedTrigger: TriggerConfig = {
  id: 'pagerduty_incident_acknowledged',
  name: 'PagerDuty Incident Acknowledged',
  provider: 'pagerduty',
  description: 'Trigger workflow when an incident is acknowledged in PagerDuty',
  version: '1.0.0',
  icon: PagerDutyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'pagerduty_incident_acknowledged',
    triggerOptions: pagerdutyTriggerOptions,
    setupInstructions: pagerdutySetupInstructions('Incident Acknowledged'),
    extraFields: buildPagerDutyExtraFields('pagerduty_incident_acknowledged'),
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
