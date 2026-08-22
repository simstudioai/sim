import { PhotonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPhotonImessageAuthFields,
  buildPhotonImessageOutputs,
  photonImessageSetupInstructions,
  photonImessageTriggerOptions,
} from '@/triggers/photon_imessage/utils'
import type { TriggerConfig } from '@/triggers/types'

export const photonImessageMessageReceivedTrigger: TriggerConfig = {
  id: 'photon_imessage_message_received',
  name: 'Photon iMessage Received',
  provider: 'photon_imessage',
  description: 'Trigger workflow when an inbound iMessage is received through Photon',
  version: '1.0.0',
  icon: PhotonIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'photon_imessage_message_received',
    triggerOptions: photonImessageTriggerOptions,
    includeDropdown: true,
    setupInstructions: photonImessageSetupInstructions(),
    extraFields: buildPhotonImessageAuthFields('photon_imessage_message_received'),
  }),

  outputs: buildPhotonImessageOutputs(),

  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
