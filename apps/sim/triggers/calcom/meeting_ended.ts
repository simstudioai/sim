import { CalComIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildMeetingEndedOutputs,
  calcomSetupInstructions,
  calcomTriggerOptions,
  calcomWebhookSecretField,
} from '@/triggers/calcom/utils'
import type { TriggerConfig } from '@/triggers/types'

export const calcomMeetingEndedTrigger: TriggerConfig = {
  id: 'calcom_meeting_ended',
  name: 'CalCom Meeting Ended',
  provider: 'calcom',
  description: 'Trigger workflow when a Cal.com meeting ends',
  version: '1.0.0',
  icon: CalComIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'calcom_meeting_ended',
    triggerOptions: calcomTriggerOptions,
    setupInstructions: calcomSetupInstructions('meeting_ended'),
    extraFields: [calcomWebhookSecretField('calcom_meeting_ended')],
  }),

  outputs: buildMeetingEndedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cal-Signature-256': '<hmac-sha256-hex>',
    },
  },
}
