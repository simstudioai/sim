import { RootlyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildRootlyAlertOutputs,
  buildRootlyExtraFields,
  rootlySetupInstructions,
  rootlyTriggerOptions,
} from '@/triggers/rootly/utils'
import type { TriggerConfig } from '@/triggers/types'

export const rootlyAlertCreatedTrigger: TriggerConfig = {
  id: 'rootly_alert_created',
  name: 'Rootly Alert Created',
  provider: 'rootly',
  description: 'Trigger workflow when a new alert is created in Rootly',
  version: '1.0.0',
  icon: RootlyIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'rootly_alert_created',
    triggerOptions: rootlyTriggerOptions,
    setupInstructions: rootlySetupInstructions('alert.created'),
    extraFields: buildRootlyExtraFields('rootly_alert_created'),
  }),
  outputs: buildRootlyAlertOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
