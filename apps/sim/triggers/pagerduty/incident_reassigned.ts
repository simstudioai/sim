import { PagerDutyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPagerDutyExtraFields,
  buildPagerDutyIncidentOutputs,
  pagerdutySetupInstructions,
  pagerdutyTriggerOptions,
} from '@/triggers/pagerduty/utils'
import type { TriggerConfig } from '@/triggers/types'

export const pagerdutyIncidentReassignedTrigger: TriggerConfig = {
  id: 'pagerduty_incident_reassigned',
  name: 'PagerDuty Incident Reassigned',
  provider: 'pagerduty',
  description: 'Trigger workflow when an incident is reassigned in PagerDuty',
  version: '1.0.0',
  icon: PagerDutyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'pagerduty_incident_reassigned',
    triggerOptions: pagerdutyTriggerOptions,
    setupInstructions: pagerdutySetupInstructions('Incident Reassigned'),
    extraFields: buildPagerDutyExtraFields('pagerduty_incident_reassigned'),
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
