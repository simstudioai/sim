import { SalesforceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildSalesforceExtraFields,
  buildSalesforceRecordOutputs,
  salesforceSetupInstructions,
  salesforceTriggerOptions,
} from '@/triggers/salesforce/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Salesforce Record Updated Trigger
 */
export const salesforceRecordUpdatedTrigger: TriggerConfig = {
  id: 'salesforce_record_updated',
  name: 'Salesforce Record Updated',
  provider: 'salesforce',
  description: 'Trigger workflow when a Salesforce record is updated',
  version: '1.0.0',
  icon: SalesforceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'salesforce_record_updated',
    triggerOptions: salesforceTriggerOptions,
    setupInstructions: salesforceSetupInstructions('Record Updated'),
    extraFields: buildSalesforceExtraFields('salesforce_record_updated'),
  }),

  outputs: buildSalesforceRecordOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
