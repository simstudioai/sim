import { PhotonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPhotonImessageCredFields,
  buildPhotonImessageWebhookOutputs,
  photonImessageSetupInstructions,
  photonImessageTriggerOptions,
} from '@/triggers/photon_imessage/utils'
import type { TriggerConfig } from '@/triggers/types'

export const photonImessageWebhookTrigger: TriggerConfig = {
  id: 'photon_imessage_webhook',
  name: 'Photon Any Event',
  provider: 'photon_imessage',
  description:
    'Trigger workflow on every inbound Photon delivery: messages, tapbacks, and read receipts',
  version: '1.0.0',
  icon: PhotonIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'photon_imessage_webhook',
    triggerOptions: photonImessageTriggerOptions,
    setupInstructions: photonImessageSetupInstructions('all events'),
    extraFields: buildPhotonImessageCredFields('photon_imessage_webhook'),
  }),

  outputs: buildPhotonImessageWebhookOutputs(),

  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
