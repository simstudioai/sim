import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBranchSleepingTrigger: TriggerConfig = {
  id: 'planetscale_branch_sleeping',
  name: 'PlanetScale Branch Sleeping',
  provider: 'planetscale',
  description: 'Run on PlanetScale branch sleeping events. Supports Vitess, Neki, and Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_branch_sleeping',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Branch Sleeping'),
    extraFields: buildPlanetScaleExtraFields('planetscale_branch_sleeping'),
  }),
  outputs: buildPlanetScaleOutputs('branch'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
