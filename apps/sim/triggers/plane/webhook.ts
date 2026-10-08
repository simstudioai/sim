import { PlaneIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planeWebhookTrigger: TriggerConfig = {
  id: 'plane_webhook',
  name: 'Plane All Events',
  provider: 'plane',
  description: 'Trigger a workflow for any signed Plane event.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_webhook',
    triggerOptions: planeTriggerOptions,
    includeDropdown: true,
    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_webhook'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
