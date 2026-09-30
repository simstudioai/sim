import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBranchStartMaintenanceTrigger: TriggerConfig = {
  id: 'planetscale_branch_start_maintenance',
  name: 'PlanetScale Branch Start Maintenance',
  provider: 'planetscale',
  description:
    'Run on PlanetScale branch start maintenance events. Supports Vitess, Neki, and Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_branch_start_maintenance',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Branch Start Maintenance'),
    extraFields: buildPlanetScaleExtraFields('planetscale_branch_start_maintenance'),
  }),
  outputs: buildPlanetScaleOutputs('branch'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
