import { RevenueCatIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRevenueCatExtraFields,
  buildRevenueCatOutputs,
  revenueCatSetupInstructions,
  revenueCatTriggerOptions,
} from '@/triggers/revenuecat/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * RevenueCat Cancellation Trigger. Fires on CANCELLATION events.
 */
export const revenueCatCancellationTrigger: TriggerConfig = {
  id: 'revenuecat_cancellation',
  name: 'RevenueCat Cancellation',
  provider: 'revenuecat',
  description: 'Trigger workflow when a subscriber cancels a RevenueCat subscription',
  version: '1.0.0',
  icon: RevenueCatIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'revenuecat_cancellation',
    triggerOptions: revenueCatTriggerOptions,
    setupInstructions: revenueCatSetupInstructions('Cancellation'),
    extraFields: buildRevenueCatExtraFields('revenuecat_cancellation'),
  }),
  outputs: buildRevenueCatOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'your-configured-secret',
    },
  },
}
