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
 * RevenueCat Expiration Trigger. Fires on EXPIRATION events.
 */
export const revenueCatExpirationTrigger: TriggerConfig = {
  id: 'revenuecat_expiration',
  name: 'RevenueCat Expiration',
  provider: 'revenuecat',
  description: 'Trigger workflow when a RevenueCat subscription expires',
  version: '1.0.0',
  icon: RevenueCatIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'revenuecat_expiration',
    triggerOptions: revenueCatTriggerOptions,
    setupInstructions: revenueCatSetupInstructions('Expiration'),
    extraFields: buildRevenueCatExtraFields('revenuecat_expiration'),
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
