import { RootlyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRootlyExtraFields,
  buildRootlyIncidentOutputs,
  rootlySetupInstructions,
  rootlyTriggerOptions,
} from '@/triggers/rootly/utils'
import type { TriggerConfig } from '@/triggers/types'

export const rootlyIncidentCreatedTrigger: TriggerConfig = {
  id: 'rootly_incident_created',
  name: 'Rootly Incident Created',
  provider: 'rootly',
  description: 'Trigger workflow when a new incident is created in Rootly',
  version: '1.0.0',
  icon: RootlyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'rootly_incident_created',
    triggerOptions: rootlyTriggerOptions,
    includeDropdown: true,
    setupInstructions: rootlySetupInstructions('incident.created'),
    extraFields: buildRootlyExtraFields('rootly_incident_created'),
  }),
  outputs: buildRootlyIncidentOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
