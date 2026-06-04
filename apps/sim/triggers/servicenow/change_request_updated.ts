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
 * ServiceNow Change Request Updated Trigger
 */
export const servicenowChangeRequestUpdatedTrigger: TriggerConfig = {
  id: 'servicenow_change_request_updated',
  name: 'ServiceNow Change Request Updated',
  provider: 'servicenow',
  description: 'Trigger workflow when a change request is updated in ServiceNow',
  version: '1.0.0',
  icon: ServiceNowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'servicenow_change_request_updated',
    triggerOptions: servicenowTriggerOptions,
    setupInstructions: servicenowSetupInstructions('Update (record modification)'),
    extraFields: buildServiceNowExtraFields('servicenow_change_request_updated'),
  }),

  outputs: buildChangeRequestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
