import { PlaneIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planeWorkitemUpdatedTrigger: TriggerConfig = {
  id: 'plane_workitem_updated',
  name: 'Plane Work Item Updated',
  provider: 'plane',
  description: 'Trigger a workflow for Plane work item updated events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_workitem_updated',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_workitem_updated'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
