import { TwilioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildTwilioSmsAuthFields,
  buildTwilioSmsOutputs,
  twilioSmsReceivedInstructions,
  twilioSmsTriggerOptions,
} from '@/triggers/twilio/utils'
import type { TriggerConfig } from '@/triggers/types'

export const twilioSmsReceivedTrigger: TriggerConfig = {
  id: 'twilio_sms_received',
  name: 'Twilio SMS Received',
  provider: 'twilio',
  description: 'Trigger workflow when an inbound SMS or MMS message is received via Twilio',
  version: '1.0.0',
  icon: TwilioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'twilio_sms_received',
    triggerOptions: twilioSmsTriggerOptions,
    includeDropdown: true,
    setupInstructions: twilioSmsReceivedInstructions(),
    extraFields: buildTwilioSmsAuthFields('twilio_sms_received'),
  }),

  outputs: buildTwilioSmsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  },
}
