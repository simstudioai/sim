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
 * Lemlist Interested Trigger
 * Triggers when a lead is marked as interested in a Lemlist campaign
 */
export const lemlistInterestedTrigger: TriggerConfig = {
  id: 'lemlist_interested',
  name: 'Lemlist Lead Interested',
  provider: 'lemlist',
  description: 'Trigger workflow when a lead is marked as interested',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_interested',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('interested'),
    extraFields: buildLemlistExtraFields('lemlist_interested'),
  }),

  outputs: buildInterestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
