import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBranchPrimaryPromotedTrigger: TriggerConfig = {
  id: 'planetscale_branch_primary_promoted',
  name: 'PlanetScale Branch Primary Promoted',
  provider: 'planetscale',
  description: 'Run on PlanetScale branch primary promoted events. Supports Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_branch_primary_promoted',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Branch Primary Promoted'),
    extraFields: buildPlanetScaleExtraFields('planetscale_branch_primary_promoted'),
  }),
  outputs: buildPlanetScaleOutputs('branch'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
