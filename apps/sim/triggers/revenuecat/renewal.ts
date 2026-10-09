import { RevenueCatIcon } from '@/components/icons'
import {
  buildRevenueCatExtraFields,
  buildRevenueCatOutputs,
  revenueCatSetupInstructions,
  revenueCatTriggerOptions,
} from '@/triggers/revenuecat/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

/**
 * RevenueCat Renewal Trigger. Fires on RENEWAL events.
 */
export const revenueCatRenewalTrigger: TriggerConfig = {
  id: 'revenuecat_renewal',
  name: 'RevenueCat Renewal',
  provider: 'revenuecat',
  description: 'Trigger workflow when a RevenueCat subscription renews',
  version: '1.0.0',
  icon: RevenueCatIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'revenuecat_renewal',
    triggerOptions: revenueCatTriggerOptions,
    setupInstructions: revenueCatSetupInstructions('Renewal'),
    extraFields: buildRevenueCatExtraFields('revenuecat_renewal'),
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
