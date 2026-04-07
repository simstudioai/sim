import { GongIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildGenericOutputs,
  buildGongExtraFields,
  gongSetupInstructions,
  gongTriggerOptions,
} from './utils'

/**
 * Gong Generic Webhook Trigger
 *
 * Primary trigger - includes the dropdown for selecting trigger type.
 * Accepts all webhook events from Gong automation rules.
 */
export const gongWebhookTrigger: TriggerConfig = {
  id: 'gong_webhook',
  name: 'Gong Webhook',
  provider: 'gong',
  description: 'Generic webhook trigger for all Gong events',
  version: '1.0.0',
  icon: GongIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gong_webhook',
    triggerOptions: gongTriggerOptions,
    includeDropdown: true,
    setupInstructions: gongSetupInstructions('All Events'),
    extraFields: buildGongExtraFields('gong_webhook'),
  }),

  outputs: buildGenericOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
