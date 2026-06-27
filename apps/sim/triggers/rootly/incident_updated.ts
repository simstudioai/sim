import { RootlyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRootlyExtraFields,
  buildRootlyIncidentOutputs,
  rootlySetupInstructions,
  rootlyTriggerOptions,
} from '@/triggers/rootly/utils'
import type { TriggerConfig } from '@/triggers/types'

export const rootlyIncidentUpdatedTrigger: TriggerConfig = {
  id: 'rootly_incident_updated',
  name: 'Rootly Incident Updated',
  provider: 'rootly',
  description: 'Trigger workflow when an incident is updated in Rootly',
  version: '1.0.0',
  icon: RootlyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'rootly_incident_updated',
    triggerOptions: rootlyTriggerOptions,
    setupInstructions: rootlySetupInstructions('incident.updated'),
    extraFields: buildRootlyExtraFields('rootly_incident_updated'),
  }),
  outputs: buildRootlyIncidentOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
