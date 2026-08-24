import { PhotonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPhotonImessageCredFields,
  buildPhotonImessageReactionOutputs,
  photonImessageSetupInstructions,
  photonImessageTriggerOptions,
} from '@/triggers/photon_imessage/utils'
import type { TriggerConfig } from '@/triggers/types'

export const photonImessageReactionReceivedTrigger: TriggerConfig = {
  id: 'photon_imessage_reaction_received',
  name: 'Photon Tapback Received',
  provider: 'photon_imessage',
  description: 'Trigger workflow when someone reacts to a message with a tapback or emoji',
  version: '1.0.0',
  icon: PhotonIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'photon_imessage_reaction_received',
    triggerOptions: photonImessageTriggerOptions,
    setupInstructions: photonImessageSetupInstructions('tapback reactions'),
    extraFields: buildPhotonImessageCredFields('photon_imessage_reaction_received'),
  }),

  outputs: buildPhotonImessageReactionOutputs(),

  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
