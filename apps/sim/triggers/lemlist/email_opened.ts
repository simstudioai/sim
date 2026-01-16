import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailOpenedOutputs,
  buildLemlistExtraFields,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Lemlist Email Opened Trigger
 * Triggers when a lead opens an email in a Lemlist campaign
 */
export const lemlistEmailOpenedTrigger: TriggerConfig = {
  id: 'lemlist_email_opened',
  name: 'Lemlist Email Opened',
  provider: 'lemlist',
  description: 'Trigger workflow when a lead opens an email',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_email_opened',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('emailsOpened'),
    extraFields: buildLemlistExtraFields('lemlist_email_opened'),
  }),

  outputs: buildEmailOpenedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
