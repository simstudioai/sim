import { PlaneIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planeWorkitemVoteCreatedTrigger: TriggerConfig = {
  id: 'plane_workitem_vote_created',
  name: 'Plane Work Item Vote Created',
  provider: 'plane',
  description: 'Trigger a workflow for Plane work item vote created events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_workitem_vote_created',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_workitem_vote_created'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
