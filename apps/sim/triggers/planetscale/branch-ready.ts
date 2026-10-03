import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBranchReadyTrigger: TriggerConfig = {
  id: 'planetscale_branch_ready',
  name: 'PlanetScale Branch Ready',
  provider: 'planetscale',
  description: 'Run on PlanetScale branch ready events. Supports Vitess, Neki, and Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_branch_ready',
    triggerOptions: planetscaleTriggerOptions,
    includeDropdown: true,
    setupInstructions: planetscaleSetupInstructions('Branch Ready'),
    extraFields: buildPlanetScaleExtraFields('planetscale_branch_ready'),
  }),
  outputs: buildPlanetScaleOutputs('branch'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
