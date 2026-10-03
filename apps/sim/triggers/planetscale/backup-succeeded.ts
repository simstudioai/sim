import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBackupSucceededTrigger: TriggerConfig = {
  id: 'planetscale_backup_succeeded',
  name: 'PlanetScale Backup Succeeded',
  provider: 'planetscale',
  description: 'Run on PlanetScale backup succeeded events. Supports Vitess, Neki, and Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_backup_succeeded',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Backup Succeeded'),
    extraFields: buildPlanetScaleExtraFields('planetscale_backup_succeeded'),
  }),
  outputs: buildPlanetScaleOutputs('backup'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
