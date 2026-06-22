import { PagerDutyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPagerDutyExtraFields,
  buildPagerDutyIncidentOutputs,
  pagerdutySetupInstructions,
  pagerdutyTriggerOptions,
} from '@/triggers/pagerduty/utils'
import type { TriggerConfig } from '@/triggers/types'

export const pagerdutyWebhookTrigger: TriggerConfig = {
  id: 'pagerduty_webhook',
  name: 'PagerDuty Incident Event',
  provider: 'pagerduty',
  description: 'Trigger workflow from any PagerDuty incident event',
  version: '1.0.0',
  icon: PagerDutyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'pagerduty_webhook',
    triggerOptions: pagerdutyTriggerOptions,
    setupInstructions: pagerdutySetupInstructions('all incident events'),
    extraFields: buildPagerDutyExtraFields('pagerduty_webhook'),
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
