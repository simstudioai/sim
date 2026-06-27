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
 * incident.io Incident Status Updated Trigger.
 * Fires when an incident's status changes (public_incident.incident_status_updated_v2).
 */
export const incidentioIncidentStatusUpdatedTrigger: TriggerConfig = {
  id: 'incidentio_incident_status_updated',
  name: 'incident.io Incident Status Updated',
  provider: 'incidentio',
  description: "Trigger workflow when an incident's status changes in incident.io",
  version: '1.0.0',
  icon: IncidentioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'incidentio_incident_status_updated',
    triggerOptions: incidentioTriggerOptions,
    setupInstructions: incidentioSetupInstructions('Incident status updated'),
    extraFields: buildIncidentioExtraFields('incidentio_incident_status_updated'),
  }),

  outputs: buildIncidentioIncidentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
