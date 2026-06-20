import { PagerDutyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPagerDutyExtraFields,
  buildPagerDutyIncidentOutputs,
  pagerdutySetupInstructions,
  pagerdutyTriggerOptions,
} from '@/triggers/pagerduty/utils'
import type { TriggerConfig } from '@/triggers/types'

export const pagerdutyIncidentTriggeredTrigger: TriggerConfig = {
  id: 'pagerduty_incident_triggered',
  name: 'PagerDuty Incident Triggered',
  provider: 'pagerduty',
  description: 'Trigger workflow when a new incident is triggered in PagerDuty',
  version: '1.0.0',
  icon: PagerDutyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'pagerduty_incident_triggered',
    triggerOptions: pagerdutyTriggerOptions,
    includeDropdown: true,
    setupInstructions: pagerdutySetupInstructions('Incident Triggered'),
    extraFields: buildPagerDutyExtraFields('pagerduty_incident_triggered'),
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
