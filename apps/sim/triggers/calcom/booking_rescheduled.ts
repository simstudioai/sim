import { CalComIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRescheduledOutputs,
  calcomSetupInstructions,
  calcomTriggerOptions,
  calcomWebhookSecretField,
} from '@/triggers/calcom/utils'
import type { TriggerConfig } from '@/triggers/types'

export const calcomBookingRescheduledTrigger: TriggerConfig = {
  id: 'calcom_booking_rescheduled',
  name: 'CalCom Booking Rescheduled',
  provider: 'calcom',
  description: 'Trigger workflow when a booking is rescheduled in Cal.com',
  version: '1.0.0',
  icon: CalComIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'calcom_booking_rescheduled',
    triggerOptions: calcomTriggerOptions,
    setupInstructions: calcomSetupInstructions('rescheduled'),
    extraFields: [calcomWebhookSecretField('calcom_booking_rescheduled')],
  }),

  outputs: buildRescheduledOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cal-Signature-256': '<hmac-sha256-hex>',
    },
  },
}
