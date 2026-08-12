import { WindchillIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildWindchillExtraFields,
  windchillSetupInstructions,
  windchillTriggerOptions,
} from '@/triggers/windchill/utils'

export const windchillDocumentLifecycleStateChangedTrigger: TriggerConfig = {
  id: 'windchill_document_lifecycle_state_changed',
  name: 'Windchill Document Lifecycle State Changed',
  provider: 'windchill',
  description: 'Trigger a workflow when a Windchill document enters a selected lifecycle state',
  version: '1.0.0',
  icon: WindchillIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'windchill_document_lifecycle_state_changed',
    triggerOptions: windchillTriggerOptions,
    setupInstructions: windchillSetupInstructions('a document lifecycle state change'),
    extraFields: buildWindchillExtraFields('windchill_document_lifecycle_state_changed', {
      lifecycleState: true,
    }),
  }),
  outputs: {},
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
