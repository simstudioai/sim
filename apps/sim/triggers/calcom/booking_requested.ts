import { CalComIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRequestedOutputs,
  calcomSetupInstructions,
  calcomTriggerOptions,
  calcomWebhookSecretField,
} from '@/triggers/calcom/utils'
import type { TriggerConfig } from '@/triggers/types'

export const calcomBookingRequestedTrigger: TriggerConfig = {
  id: 'calcom_booking_requested',
  name: 'CalCom Booking Requested',
  provider: 'calcom',
  description: 'Trigger workflow when a booking request is submitted (pending confirmation)',
  version: '1.0.0',
  icon: CalComIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'calcom_booking_requested',
    triggerOptions: calcomTriggerOptions,
    setupInstructions: calcomSetupInstructions('requested'),
    extraFields: [calcomWebhookSecretField('calcom_booking_requested')],
  }),

  outputs: buildRequestedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cal-Signature-256': '<hmac-sha256-hex>',
    },
  },
}
