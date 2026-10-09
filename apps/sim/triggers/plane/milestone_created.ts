import { PlaneIcon } from '@/components/icons'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const planeMilestoneCreatedTrigger: TriggerConfig = {
  id: 'plane_milestone_created',
  name: 'Plane Milestone Created',
  provider: 'plane',
  description: 'Trigger a workflow for Plane milestone created events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_milestone_created',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_milestone_created'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
