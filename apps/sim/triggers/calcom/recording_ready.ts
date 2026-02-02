import { CalComIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRecordingReadyOutputs,
  calcomSetupInstructions,
  calcomTriggerOptions,
  calcomWebhookSecretField,
} from '@/triggers/calcom/utils'
import type { TriggerConfig } from '@/triggers/types'

export const calcomRecordingReadyTrigger: TriggerConfig = {
  id: 'calcom_recording_ready',
  name: 'CalCom Recording Ready',
  provider: 'calcom',
  description: 'Trigger workflow when a meeting recording is ready for download',
  version: '1.0.0',
  icon: CalComIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'calcom_recording_ready',
    triggerOptions: calcomTriggerOptions,
    setupInstructions: calcomSetupInstructions('recording_ready'),
    extraFields: [calcomWebhookSecretField('calcom_recording_ready')],
  }),

  outputs: buildRecordingReadyOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cal-Signature-256': '<hmac-sha256-hex>',
    },
  },
}
