import { PlaneIcon } from '@/components/icons'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const planeWorkitemLinkCreatedTrigger: TriggerConfig = {
  id: 'plane_workitem_link_created',
  name: 'Plane Work Item Link Created',
  provider: 'plane',
  description: 'Trigger a workflow for Plane work item link created events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_workitem_link_created',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_workitem_link_created'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
