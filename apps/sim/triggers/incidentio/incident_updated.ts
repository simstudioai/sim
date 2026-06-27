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
 * incident.io Incident Updated Trigger.
 * Fires when an incident is updated (public_incident.incident_updated_v2).
 */
export const incidentioIncidentUpdatedTrigger: TriggerConfig = {
  id: 'incidentio_incident_updated',
  name: 'incident.io Incident Updated',
  provider: 'incidentio',
  description: 'Trigger workflow when an incident is updated in incident.io',
  version: '1.0.0',
  icon: IncidentioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'incidentio_incident_updated',
    triggerOptions: incidentioTriggerOptions,
    setupInstructions: incidentioSetupInstructions('Incident updated'),
    extraFields: buildIncidentioExtraFields('incidentio_incident_updated'),
  }),

  outputs: buildIncidentioIncidentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
