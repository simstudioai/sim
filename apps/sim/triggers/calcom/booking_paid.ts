import { CalComIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPaidOutputs,
  calcomSetupInstructions,
  calcomTriggerOptions,
  calcomWebhookSecretField,
} from '@/triggers/calcom/utils'
import type { TriggerConfig } from '@/triggers/types'

export const calcomBookingPaidTrigger: TriggerConfig = {
  id: 'calcom_booking_paid',
  name: 'CalCom Booking Paid',
  provider: 'calcom',
  description: 'Trigger workflow when payment is completed for a paid booking',
  version: '1.0.0',
  icon: CalComIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'calcom_booking_paid',
    triggerOptions: calcomTriggerOptions,
    setupInstructions: calcomSetupInstructions('paid'),
    extraFields: [calcomWebhookSecretField('calcom_booking_paid')],
  }),

  outputs: buildPaidOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cal-Signature-256': '<hmac-sha256-hex>',
    },
  },
}
