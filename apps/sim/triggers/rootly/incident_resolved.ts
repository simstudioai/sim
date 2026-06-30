import { RootlyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRootlyExtraFields,
  buildRootlyIncidentOutputs,
  rootlySetupInstructions,
  rootlyTriggerOptions,
} from '@/triggers/rootly/utils'
import type { TriggerConfig } from '@/triggers/types'

export const rootlyIncidentResolvedTrigger: TriggerConfig = {
  id: 'rootly_incident_resolved',
  name: 'Rootly Incident Resolved',
  provider: 'rootly',
  description: 'Trigger workflow when an incident is resolved in Rootly',
  version: '1.0.0',
  icon: RootlyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'rootly_incident_resolved',
    triggerOptions: rootlyTriggerOptions,
    setupInstructions: rootlySetupInstructions('incident.resolved'),
    extraFields: buildRootlyExtraFields('rootly_incident_resolved'),
  }),
  outputs: buildRootlyIncidentOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
