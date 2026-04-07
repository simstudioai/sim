import { SalesforceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildSalesforceAuthOnlyFields,
  buildSalesforceOpportunityStageOutputs,
  salesforceSetupInstructions,
  salesforceTriggerOptions,
} from '@/triggers/salesforce/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Salesforce Opportunity Stage Changed Trigger
 */
export const salesforceOpportunityStageChangedTrigger: TriggerConfig = {
  id: 'salesforce_opportunity_stage_changed',
  name: 'Salesforce Opportunity Stage Changed',
  provider: 'salesforce',
  description: 'Trigger workflow when an opportunity stage changes',
  version: '1.0.0',
  icon: SalesforceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'salesforce_opportunity_stage_changed',
    triggerOptions: salesforceTriggerOptions,
    setupInstructions: salesforceSetupInstructions('Opportunity Stage Changed'),
    extraFields: buildSalesforceAuthOnlyFields('salesforce_opportunity_stage_changed'),
  }),

  outputs: buildSalesforceOpportunityStageOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
