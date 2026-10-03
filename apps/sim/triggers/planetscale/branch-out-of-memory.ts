import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBranchOutOfMemoryTrigger: TriggerConfig = {
  id: 'planetscale_branch_out_of_memory',
  name: 'PlanetScale Branch Out of Memory',
  provider: 'planetscale',
  description: 'Run on PlanetScale branch out of memory events. Supports Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_branch_out_of_memory',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Branch Out of Memory'),
    extraFields: buildPlanetScaleExtraFields('planetscale_branch_out_of_memory'),
  }),
  outputs: buildPlanetScaleOutputs('branch'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
