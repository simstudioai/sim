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
 * RevenueCat Product Change Trigger. Fires on PRODUCT_CHANGE events.
 */
export const revenueCatProductChangeTrigger: TriggerConfig = {
  id: 'revenuecat_product_change',
  name: 'RevenueCat Product Change',
  provider: 'revenuecat',
  description: 'Trigger workflow when a subscriber changes their RevenueCat subscription product',
  version: '1.0.0',
  icon: RevenueCatIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'revenuecat_product_change',
    triggerOptions: revenueCatTriggerOptions,
    setupInstructions: revenueCatSetupInstructions('Product Change'),
    extraFields: buildRevenueCatExtraFields('revenuecat_product_change'),
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
