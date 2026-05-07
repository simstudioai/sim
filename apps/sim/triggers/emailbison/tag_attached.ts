import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonTagAttachedOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonTagAttachedTrigger: TriggerConfig = {
  id: 'emailbison_tag_attached',
  name: 'Email Bison Tag Attached',
  provider: 'emailbison',
  description: 'Trigger when a custom tag is attached to a taggable in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_tag_attached',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Tag Attached'),
    extraFields: buildEmailBisonExtraFields('emailbison_tag_attached'),
  }),
  outputs: buildEmailBisonTagAttachedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
