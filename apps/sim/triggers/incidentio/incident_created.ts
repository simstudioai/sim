import { IncidentioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIncidentioExtraFields,
  buildIncidentioIncidentOutputs,
  incidentioSetupInstructions,
  incidentioTriggerOptions,
} from '@/triggers/incidentio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * incident.io Incident Created Trigger.
 * Fires when a new incident is created (public_incident.incident_created_v2).
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 */
export const incidentioIncidentCreatedTrigger: TriggerConfig = {
  id: 'incidentio_incident_created',
  name: 'incident.io Incident Created',
  provider: 'incidentio',
  description: 'Trigger workflow when an incident is created in incident.io',
  version: '1.0.0',
  icon: IncidentioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'incidentio_incident_created',
    triggerOptions: incidentioTriggerOptions,
    includeDropdown: true,
    setupInstructions: incidentioSetupInstructions('Incident created'),
    extraFields: buildIncidentioExtraFields('incidentio_incident_created'),
  }),

  outputs: buildIncidentioIncidentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
