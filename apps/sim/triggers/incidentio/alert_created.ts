import { IncidentioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIncidentioAlertOutputs,
  buildIncidentioExtraFields,
  incidentioSetupInstructions,
  incidentioTriggerOptions,
} from '@/triggers/incidentio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * incident.io Alert Created Trigger.
 * Fires when a new alert is created (public_alert.alert_created_v1).
 */
export const incidentioAlertCreatedTrigger: TriggerConfig = {
  id: 'incidentio_alert_created',
  name: 'incident.io Alert Created',
  provider: 'incidentio',
  description: 'Trigger workflow when an alert is created in incident.io',
  version: '1.0.0',
  icon: IncidentioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'incidentio_alert_created',
    triggerOptions: incidentioTriggerOptions,
    setupInstructions: incidentioSetupInstructions('Alert created'),
    extraFields: buildIncidentioExtraFields('incidentio_alert_created'),
  }),

  outputs: buildIncidentioAlertOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
