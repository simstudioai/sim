import { LemlistIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailClickedOutputs,
  buildLemlistExtraFields,
  lemlistSetupInstructions,
  lemlistTriggerOptions,
} from '@/triggers/lemlist/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Lemlist Email Clicked Trigger
 * Triggers when a lead clicks a link in an email
 */
export const lemlistEmailClickedTrigger: TriggerConfig = {
  id: 'lemlist_email_clicked',
  name: 'Lemlist Email Clicked',
  provider: 'lemlist',
  description: 'Trigger workflow when a lead clicks a link in an email',
  version: '1.0.0',
  icon: LemlistIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'lemlist_email_clicked',
    triggerOptions: lemlistTriggerOptions,
    setupInstructions: lemlistSetupInstructions('emailsClicked'),
    extraFields: buildLemlistExtraFields('lemlist_email_clicked'),
  }),

  outputs: buildEmailClickedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
