import { PlaneIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planeCycleCreatedTrigger: TriggerConfig = {
  id: 'plane_cycle_created',
  name: 'Plane Cycle Created',
  provider: 'plane',
  description: 'Trigger a workflow for Plane cycle created events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_cycle_created',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_cycle_created'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
