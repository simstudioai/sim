import { SendblueIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildSendblueOutputs,
  sendblueSetupInstructions,
  sendblueTriggerOptions,
} from '@/triggers/sendblue/utils'
import type { TriggerConfig } from '@/triggers/types'

export const sendblueMessageReceivedTrigger: TriggerConfig = {
  id: 'sendblue_message_received',
  name: 'Sendblue Message Received',
  provider: 'sendblue',
  description: 'Trigger when an inbound iMessage or SMS is received in Sendblue',
  version: '1.0.0',
  icon: SendblueIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'sendblue_message_received',
    triggerOptions: sendblueTriggerOptions,
    includeDropdown: true,
    setupInstructions: sendblueSetupInstructions('Message Received'),
  }),
  outputs: buildSendblueOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
