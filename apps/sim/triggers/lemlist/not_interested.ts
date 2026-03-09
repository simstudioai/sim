import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildInterestOutputs,
  buildLemlistExtraFields,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Lemlist Not Interested Trigger
 * Triggers when a lead is marked as not interested in a Lemlist campaign
 */
export const lemlistNotInterestedTrigger: TriggerConfig = {
  id: 'lemlist_not_interested',
  name: 'Lemlist Lead Not Interested',
  provider: 'lemlist',
  description: 'Trigger workflow when a lead is marked as not interested',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_not_interested',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('notInterested'),
    extraFields: buildLemlistExtraFields('lemlist_not_interested'),
  }),

  outputs: buildInterestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
