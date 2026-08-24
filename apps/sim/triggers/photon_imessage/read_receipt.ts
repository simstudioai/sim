import { PhotonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPhotonImessageCredFields,
  buildPhotonImessageReadReceiptOutputs,
  photonImessageSetupInstructions,
  photonImessageTriggerOptions,
} from '@/triggers/photon_imessage/utils'
import type { TriggerConfig } from '@/triggers/types'

export const photonImessageReadReceiptTrigger: TriggerConfig = {
  id: 'photon_imessage_read_receipt',
  name: 'Photon Read Receipt',
  provider: 'photon_imessage',
  description: 'Trigger workflow when a sent message is read',
  version: '1.0.0',
  icon: PhotonIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'photon_imessage_read_receipt',
    triggerOptions: photonImessageTriggerOptions,
    setupInstructions: photonImessageSetupInstructions('read receipts'),
    extraFields: buildPhotonImessageCredFields('photon_imessage_read_receipt'),
  }),

  outputs: buildPhotonImessageReadReceiptOutputs(),

  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
