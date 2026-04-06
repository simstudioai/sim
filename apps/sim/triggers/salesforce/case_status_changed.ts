import { SalesforceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildSalesforceAuthOnlyFields,
  buildSalesforceCaseStatusOutputs,
  salesforceSetupInstructions,
  salesforceTriggerOptions,
} from '@/triggers/salesforce/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Salesforce Case Status Changed Trigger
 */
export const salesforceCaseStatusChangedTrigger: TriggerConfig = {
  id: 'salesforce_case_status_changed',
  name: 'Salesforce Case Status Changed',
  provider: 'salesforce',
  description: 'Trigger workflow when a case status changes',
  version: '1.0.0',
  icon: SalesforceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'salesforce_case_status_changed',
    triggerOptions: salesforceTriggerOptions,
    setupInstructions: salesforceSetupInstructions('Case Status Changed'),
    extraFields: buildSalesforceAuthOnlyFields('salesforce_case_status_changed'),
  }),

  outputs: buildSalesforceCaseStatusOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
