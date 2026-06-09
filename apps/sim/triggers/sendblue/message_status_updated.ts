import { SendblueIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildSendblueOutputs,
  sendblueSetupInstructions,
  sendblueTriggerOptions,
} from '@/triggers/sendblue/utils'
import type { TriggerConfig } from '@/triggers/types'

export const sendblueMessageStatusUpdatedTrigger: TriggerConfig = {
  id: 'sendblue_message_status_updated',
  name: 'Sendblue Message Status Updated',
  provider: 'sendblue',
  description:
    'Trigger when an outbound message status changes (SENT, DELIVERED, ERROR) in Sendblue',
  version: '1.0.0',
  icon: SendblueIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'sendblue_message_status_updated',
    triggerOptions: sendblueTriggerOptions,
    setupInstructions: sendblueSetupInstructions('Message Status Updated'),
  }),
  outputs: buildSendblueOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
