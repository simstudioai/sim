import { PlanetScaleIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlanetScaleExtraFields,
  buildPlanetScaleOutputs,
  planetscaleSetupInstructions,
  planetscaleTriggerOptions,
} from '@/triggers/planetscale/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planetscaleWebhookTrigger: TriggerConfig = {
  id: 'planetscale_webhook',
  name: 'PlanetScale Selected Events',
  provider: 'planetscale',
  description:
    'Run on PlanetScale selected events. Supports the documented event-specific database engines.',
  version: '1.0.0',
  icon: PlanetScaleIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'planetscale_webhook',
    triggerOptions: planetscaleTriggerOptions,
    setupInstructions: planetscaleSetupInstructions('Selected Events'),
    extraFields: buildPlanetScaleExtraFields('planetscale_webhook'),
  }),
  outputs: buildPlanetScaleOutputs('webhook'),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PlanetScale-Signature': '...' },
  },
}
