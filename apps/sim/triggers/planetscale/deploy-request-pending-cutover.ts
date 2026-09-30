import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleDeployRequestPendingCutoverTrigger: TriggerConfig = {
  id: 'planetscale_deploy_request_pending_cutover',
  name: 'PlanetScale Deploy Request Pending Cutover',
  provider: 'planetscale',
  description: 'Run on PlanetScale deploy request pending cutover events. Supports Vitess.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_deploy_request_pending_cutover',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Deploy Request Pending Cutover'),
    extraFields: buildPlanetScaleExtraFields('planetscale_deploy_request_pending_cutover'),
  }),
  outputs: buildPlanetScaleOutputs('deploy_request'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
