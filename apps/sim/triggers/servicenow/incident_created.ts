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
 * ServiceNow Incident Created Trigger
 *
 * Primary trigger — includes the dropdown for selecting trigger type.
 */
export const servicenowIncidentCreatedTrigger: TriggerConfig = {
  id: 'servicenow_incident_created',
  name: 'ServiceNow Incident Created',
  provider: 'servicenow',
  description: 'Trigger workflow when a new incident is created in ServiceNow',
  version: '1.0.0',
  icon: ServiceNowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'servicenow_incident_created',
    triggerOptions: servicenowTriggerOptions,
    includeDropdown: true,
    setupInstructions: servicenowSetupInstructions('Insert (record creation)'),
    extraFields: buildServiceNowExtraFields('servicenow_incident_created'),
  }),

  outputs: buildIncidentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
