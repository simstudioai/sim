import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildLemlistExtraFields,
  buildLinkedInRepliedOutputs,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Lemlist LinkedIn Replied Trigger
 * Triggers when a lead replies to a LinkedIn message in a Lemlist campaign
 */
export const lemlistLinkedInRepliedTrigger: TriggerConfig = {
  id: 'lemlist_linkedin_replied',
  name: 'Lemlist LinkedIn Replied',
  provider: 'lemlist',
  description: 'Trigger workflow when a lead replies to a LinkedIn message',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_linkedin_replied',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('linkedinReplied'),
    extraFields: buildLemlistExtraFields('lemlist_linkedin_replied'),
  }),

  outputs: buildLinkedInRepliedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
