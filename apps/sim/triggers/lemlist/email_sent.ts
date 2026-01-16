import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailSentOutputs,
  buildLemlistExtraFields,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Lemlist Email Sent Trigger
 * Triggers when an email is sent in a Lemlist campaign
 */
export const lemlistEmailSentTrigger: TriggerConfig = {
  id: 'lemlist_email_sent',
  name: 'Lemlist Email Sent',
  provider: 'lemlist',
  description: 'Trigger workflow when an email is sent',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_email_sent',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('emailsSent'),
    extraFields: buildLemlistExtraFields('lemlist_email_sent'),
  }),

  outputs: buildEmailSentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
