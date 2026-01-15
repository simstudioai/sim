import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailRepliedOutputs,
  buildLemlistExtraFields,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Lemlist Email Replied Trigger
 * Triggers when a lead replies to an email in a Lemlist campaign
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 */
export const lemlistEmailRepliedTrigger: TriggerConfig = {
  id: 'lemlist_email_replied',
  name: 'Lemlist Email Replied',
  provider: 'lemlist',
  description: 'Trigger workflow when a lead replies to an email',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_email_replied',
    triggerOptions: lemlistTriggerOptions,
    includeDropdown: true,
    setupInstructions: lemlistSetupInstructions('emailsReplied'),
    extraFields: buildLemlistExtraFields('lemlist_email_replied'),
  }),

  outputs: buildEmailRepliedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
