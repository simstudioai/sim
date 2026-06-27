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
 * RevenueCat Initial Purchase Trigger.
 *
 * PRIMARY trigger — includes the trigger-type dropdown listing every RevenueCat event.
 * Fires on INITIAL_PURCHASE events.
 */
export const revenueCatInitialPurchaseTrigger: TriggerConfig = {
  id: 'revenuecat_initial_purchase',
  name: 'RevenueCat Initial Purchase',
  provider: 'revenuecat',
  description: 'Trigger workflow when a subscriber makes their first purchase in RevenueCat',
  version: '1.0.0',
  icon: RevenueCatIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'revenuecat_initial_purchase',
    triggerOptions: revenueCatTriggerOptions,
    includeDropdown: true,
    setupInstructions: revenueCatSetupInstructions('Initial Purchase'),
    extraFields: buildRevenueCatExtraFields('revenuecat_initial_purchase'),
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
