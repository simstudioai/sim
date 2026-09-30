import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleDeployRequestClosedTrigger: TriggerConfig = {
  id: 'planetscale_deploy_request_closed',
  name: 'PlanetScale Deploy Request Closed',
  provider: 'planetscale',
  description: 'Run on PlanetScale deploy request closed events. Supports Vitess.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_deploy_request_closed',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Deploy Request Closed'),
    extraFields: buildPlanetScaleExtraFields('planetscale_deploy_request_closed'),
  }),
  outputs: buildPlanetScaleOutputs('deploy_request'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
