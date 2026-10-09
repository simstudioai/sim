import { PlaneIcon } from '@/components/icons'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const planeWorkitemRelationDeletedTrigger: TriggerConfig = {
  id: 'plane_workitem_relation_deleted',
  name: 'Plane Work Item Relation Deleted',
  provider: 'plane',
  description: 'Trigger a workflow for Plane work item relation deleted events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_workitem_relation_deleted',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_workitem_relation_deleted'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
