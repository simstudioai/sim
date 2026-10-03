import { WindchillIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildWindchillExtraFields,
  windchillSetupInstructions,
  windchillTriggerOptions,
} from '@/triggers/windchill/utils'

export const windchillCustomDocumentEventTrigger: TriggerConfig = {
  id: 'windchill_custom_document_event',
  name: 'Windchill Custom Document Event',
  provider: 'windchill',
  description: 'Trigger a workflow for an installed Windchill document event',
  version: '1.0.0',
  icon: WindchillIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'windchill_custom_document_event',
    triggerOptions: windchillTriggerOptions,
    setupInstructions: windchillSetupInstructions('an installed document event'),
    extraFields: buildWindchillExtraFields('windchill_custom_document_event', {
      customEvent: true,
    }),
  }),
  outputs: {},
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
