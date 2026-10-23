import { HelpScoutIcon } from '@/components/icons'
import {
  buildCustomerEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutCustomerUpdatedTrigger: TriggerConfig = {
  id: 'helpscout_customer_updated',
  name: 'Help Scout Customer Updated',
  provider: 'helpscout',
  description: 'Trigger workflow when a Help Scout customer is updated',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_customer_updated',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Customer &gt; Updated</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_customer_updated', {
      inboxFilter: false,
    }),
  }),

  outputs: buildCustomerEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
