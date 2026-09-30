import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleDeployRequestRevertedTrigger: TriggerConfig = {
  id: 'planetscale_deploy_request_reverted',
  name: 'PlanetScale Deploy Request Reverted',
  provider: 'planetscale',
  description: 'Run on PlanetScale deploy request reverted events. Supports Vitess.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_deploy_request_reverted',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Deploy Request Reverted'),
    extraFields: buildPlanetScaleExtraFields('planetscale_deploy_request_reverted'),
  }),
  outputs: buildPlanetScaleOutputs('deploy_request'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
