import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonUntrackedReplyReceivedOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonUntrackedReplyReceivedTrigger: TriggerConfig = {
  id: 'emailbison_untracked_reply_received',
  name: 'Email Bison Untracked Reply Received',
  provider: 'emailbison',
  description: 'Trigger when Email Bison receives a reply not tied to a scheduled campaign email',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_untracked_reply_received',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Untracked Reply Received'),
    extraFields: buildEmailBisonExtraFields('emailbison_untracked_reply_received'),
  }),
  outputs: buildEmailBisonUntrackedReplyReceivedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
