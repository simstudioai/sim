import { HelpScoutIcon } from '@/components/icons'
import {
  buildGenericWebhookOutputs,
  buildHelpScoutExtraFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutWebhookTrigger: TriggerConfig = {
  id: 'helpscout_webhook',
  name: 'Help Scout Webhook (All Selected Events)',
  provider: 'helpscout',
  description:
    'Trigger on every event selected for this URL in Help Scout. Sim does not filter deliveries for this trigger.',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_webhook',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions('the events this workflow should receive'),
    extraFields: buildHelpScoutExtraFields('helpscout_webhook'),
  }),

  outputs: buildGenericWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
