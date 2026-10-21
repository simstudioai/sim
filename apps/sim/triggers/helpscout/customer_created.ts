import { HelpScoutIcon } from '@/components/icons'
import {
  buildCustomerEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutCustomerCreatedTrigger: TriggerConfig = {
  id: 'helpscout_customer_created',
  name: 'Help Scout Customer Created',
  provider: 'helpscout',
  description: 'Trigger workflow when a customer is created in Help Scout (fires for every inbox)',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_customer_created',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Customer &gt; Created</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_customer_created', {
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
