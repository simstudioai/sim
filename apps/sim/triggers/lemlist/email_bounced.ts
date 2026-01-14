import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBouncedOutputs,
  buildLemlistExtraFields,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Lemlist Email Bounced Trigger
 * Triggers when an email bounces in a Lemlist campaign
 */
export const lemlistEmailBouncedTrigger: TriggerConfig = {
  id: 'lemlist_email_bounced',
  name: 'Lemlist Email Bounced',
  provider: 'lemlist',
  description: 'Trigger workflow when an email bounces',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_email_bounced',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('emailsBounced'),
    extraFields: buildLemlistExtraFields('lemlist_email_bounced'),
  }),

  outputs: buildEmailBouncedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
