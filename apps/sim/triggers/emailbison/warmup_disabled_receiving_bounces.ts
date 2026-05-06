import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonWarmupDisabledReceivingBouncesOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonWarmupDisabledReceivingBouncesTrigger: TriggerConfig = {
  id: 'emailbison_warmup_disabled_receiving_bounces',
  name: 'Email Bison Warmup Disabled Receiving Bounces',
  provider: 'emailbison',
  description: 'Trigger when warmup is disabled for a sender email receiving too many bounces',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_warmup_disabled_receiving_bounces',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Warmup Disabled Receiving Bounces'),
    extraFields: buildEmailBisonExtraFields('emailbison_warmup_disabled_receiving_bounces'),
  }),
  outputs: buildEmailBisonWarmupDisabledReceivingBouncesOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
