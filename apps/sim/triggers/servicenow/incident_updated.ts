import { ServiceNowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIncidentOutputs,
  buildServiceNowExtraFields,
  servicenowSetupInstructions,
  servicenowTriggerOptions,
} from '@/triggers/servicenow/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * ServiceNow Incident Updated Trigger
 */
export const servicenowIncidentUpdatedTrigger: TriggerConfig = {
  id: 'servicenow_incident_updated',
  name: 'ServiceNow Incident Updated',
  provider: 'servicenow',
  description: 'Trigger workflow when an incident is updated in ServiceNow',
  version: '1.0.0',
  icon: ServiceNowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'servicenow_incident_updated',
    triggerOptions: servicenowTriggerOptions,
    setupInstructions: servicenowSetupInstructions('Update (record modification)'),
    extraFields: buildServiceNowExtraFields('servicenow_incident_updated'),
  }),

  outputs: buildIncidentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
