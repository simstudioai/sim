import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleBackupFailedTrigger: TriggerConfig = {
  id: 'planetscale_backup_failed',
  name: 'PlanetScale Backup Failed',
  provider: 'planetscale',
  description: 'Run on PlanetScale backup failed events. Supports Vitess, Neki, and Postgres.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_backup_failed',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Backup Failed'),
    extraFields: buildPlanetScaleExtraFields('planetscale_backup_failed'),
  }),
  outputs: buildPlanetScaleOutputs('backup'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
