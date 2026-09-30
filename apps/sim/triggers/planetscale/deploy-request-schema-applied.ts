import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleDeployRequestSchemaAppliedTrigger: TriggerConfig = {
  id: 'planetscale_deploy_request_schema_applied',
  name: 'PlanetScale Deploy Request Schema Applied',
  provider: 'planetscale',
  description: 'Run on PlanetScale deploy request schema applied events. Supports Vitess.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_deploy_request_schema_applied',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Deploy Request Schema Applied'),
    extraFields: buildPlanetScaleExtraFields('planetscale_deploy_request_schema_applied'),
  }),
  outputs: buildPlanetScaleOutputs('deploy_request'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
