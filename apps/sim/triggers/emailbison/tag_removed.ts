import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonTagRemovedOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonTagRemovedTrigger: TriggerConfig = {
  id: 'emailbison_tag_removed',
  name: 'Email Bison Tag Removed',
  provider: 'emailbison',
  description: 'Trigger when a custom tag is removed from a taggable in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_tag_removed',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Tag Removed'),
    extraFields: buildEmailBisonExtraFields('emailbison_tag_removed'),
  }),
  outputs: buildEmailBisonTagRemovedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
