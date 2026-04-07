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
 * Salesforce Record Created Trigger
 *
 * PRIMARY trigger — includes the dropdown for selecting trigger type.
 */
export const salesforceRecordCreatedTrigger: TriggerConfig = {
  id: 'salesforce_record_created',
  name: 'Salesforce Record Created',
  provider: 'salesforce',
  description: 'Trigger workflow when a Salesforce record is created',
  version: '1.0.0',
  icon: SalesforceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'salesforce_record_created',
    triggerOptions: salesforceTriggerOptions,
    includeDropdown: true,
    setupInstructions: salesforceSetupInstructions('Record Created'),
    extraFields: buildSalesforceExtraFields('salesforce_record_created'),
  }),

  outputs: buildSalesforceRecordOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
