import { PlaneIcon } from '@/components/icons'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const planeModuleArchivedTrigger: TriggerConfig = {
  id: 'plane_module_archived',
  name: 'Plane Module Archived',
  provider: 'plane',
  description: 'Trigger a workflow for Plane module archived events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_module_archived',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_module_archived'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
