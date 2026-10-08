import { PlaneIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planeWorkitemRelationCreatedTrigger: TriggerConfig = {
  id: 'plane_workitem_relation_created',
  name: 'Plane Work Item Relation Created',
  provider: 'plane',
  description: 'Trigger a workflow for Plane work item relation created events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_workitem_relation_created',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_workitem_relation_created'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
