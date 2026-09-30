import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBranchAnomalyTrigger: TriggerConfig = {
  id: 'planetscale_branch_anomaly',
  name: 'PlanetScale Branch Anomaly',
  provider: 'planetscale',
  description: 'Run on PlanetScale branch anomaly events. Supports Vitess, Neki, and Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_branch_anomaly',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Branch Anomaly'),
    extraFields: buildPlanetScaleExtraFields('planetscale_branch_anomaly'),
  }),
  outputs: buildPlanetScaleOutputs('branch'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
