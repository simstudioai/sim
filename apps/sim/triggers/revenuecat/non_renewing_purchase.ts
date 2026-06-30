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
 * RevenueCat Non-Renewing Purchase Trigger. Fires on NON_RENEWING_PURCHASE events.
 */
export const revenueCatNonRenewingPurchaseTrigger: TriggerConfig = {
  id: 'revenuecat_non_renewing_purchase',
  name: 'RevenueCat Non-Renewing Purchase',
  provider: 'revenuecat',
  description: 'Trigger workflow when a subscriber makes a non-renewing purchase in RevenueCat',
  version: '1.0.0',
  icon: RevenueCatIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'revenuecat_non_renewing_purchase',
    triggerOptions: revenueCatTriggerOptions,
    setupInstructions: revenueCatSetupInstructions('Non-Renewing Purchase'),
    extraFields: buildRevenueCatExtraFields('revenuecat_non_renewing_purchase'),
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
