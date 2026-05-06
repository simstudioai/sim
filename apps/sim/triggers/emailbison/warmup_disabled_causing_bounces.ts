import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonWarmupDisabledCausingBouncesOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonWarmupDisabledCausingBouncesTrigger: TriggerConfig = {
  id: 'emailbison_warmup_disabled_causing_bounces',
  name: 'Email Bison Warmup Disabled Causing Bounces',
  provider: 'emailbison',
  description: 'Trigger when warmup is disabled for a sender email causing too many bounces',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_warmup_disabled_causing_bounces',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Warmup Disabled Causing Bounces'),
    extraFields: buildEmailBisonExtraFields('emailbison_warmup_disabled_causing_bounces'),
  }),
  outputs: buildEmailBisonWarmupDisabledCausingBouncesOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
