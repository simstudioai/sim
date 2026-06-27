import { TwilioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildTwilioSmsOutputs,
  twilioSmsStatusInstructions,
  twilioSmsTriggerOptions,
} from '@/triggers/twilio/utils'
import type { TriggerConfig } from '@/triggers/types'

export const twilioSmsStatusTrigger: TriggerConfig = {
  id: 'twilio_sms_status',
  name: 'Twilio Message Status',
  provider: 'twilio',
  description: 'Trigger workflow when a Twilio message status changes (sent, delivered, failed)',
  version: '1.0.0',
  icon: TwilioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'twilio_sms_status',
    triggerOptions: twilioSmsTriggerOptions,
    setupInstructions: twilioSmsStatusInstructions(),
  }),

  outputs: buildTwilioSmsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  },
}
