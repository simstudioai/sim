import { HelpScoutIcon } from '@/components/icons'
import {
  buildGenericWebhookOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutWebhookTrigger: TriggerConfig = {
  id: 'helpscout_webhook',
  name: 'Help Scout Webhook (All Events)',
  provider: 'helpscout',
  description: 'Trigger on every supported Help Scout conversation and customer event',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_webhook',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'every supported conversation and customer event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_webhook'),
  }),

  outputs: buildGenericWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
