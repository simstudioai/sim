import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildLemlistExtraFields,
  buildLemlistOutputs,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic Lemlist Webhook Trigger
 * Captures all Lemlist webhook events with optional filtering
 */
export const lemlistWebhookTrigger: TriggerConfig = {
  id: 'lemlist_webhook',
  name: 'Lemlist Webhook (All Events)',
  provider: 'lemlist',
  description: 'Trigger workflow on any Lemlist webhook event',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_webhook',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('All Events (no type filter)'),
    extraFields: buildLemlistExtraFields('lemlist_webhook'),
  }),

  outputs: buildLemlistOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
