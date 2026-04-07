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
 * Salesforce Record Deleted Trigger
 */
export const salesforceRecordDeletedTrigger: TriggerConfig = {
  id: 'salesforce_record_deleted',
  name: 'Salesforce Record Deleted',
  provider: 'salesforce',
  description: 'Trigger workflow when a Salesforce record is deleted',
  version: '1.0.0',
  icon: SalesforceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'salesforce_record_deleted',
    triggerOptions: salesforceTriggerOptions,
    setupInstructions: salesforceSetupInstructions('Record Deleted'),
    extraFields: buildSalesforceExtraFields('salesforce_record_deleted'),
  }),

  outputs: buildSalesforceRecordOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
