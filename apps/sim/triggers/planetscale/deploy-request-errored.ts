import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleDeployRequestErroredTrigger: TriggerConfig = {
  id: 'planetscale_deploy_request_errored',
  name: 'PlanetScale Deploy Request Errored',
  provider: 'planetscale',
  description: 'Run on PlanetScale deploy request errored events. Supports Vitess.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_deploy_request_errored',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Deploy Request Errored'),
    extraFields: buildPlanetScaleExtraFields('planetscale_deploy_request_errored'),
  }),
  outputs: buildPlanetScaleOutputs('deploy_request'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
