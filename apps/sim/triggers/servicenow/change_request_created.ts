import { ServiceNowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildChangeRequestOutputs,
  buildServiceNowExtraFields,
  servicenowSetupInstructions,
  servicenowTriggerOptions,
} from '@/triggers/servicenow/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * ServiceNow Change Request Created Trigger
 */
export const servicenowChangeRequestCreatedTrigger: TriggerConfig = {
  id: 'servicenow_change_request_created',
  name: 'ServiceNow Change Request Created',
  provider: 'servicenow',
  description: 'Trigger workflow when a new change request is created in ServiceNow',
  version: '1.0.0',
  icon: ServiceNowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'servicenow_change_request_created',
    triggerOptions: servicenowTriggerOptions,
    setupInstructions: servicenowSetupInstructions('Insert (record creation)'),
    extraFields: buildServiceNowExtraFields('servicenow_change_request_created'),
  }),

  outputs: buildChangeRequestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
