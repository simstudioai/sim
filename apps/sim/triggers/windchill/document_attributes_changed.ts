import { WindchillIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildWindchillExtraFields,
  windchillSetupInstructions,
  windchillTriggerOptions,
} from '@/triggers/windchill/utils'

export const windchillDocumentAttributesChangedTrigger: TriggerConfig = {
  id: 'windchill_document_attributes_changed',
  name: 'Windchill Document Attributes Changed',
  provider: 'windchill',
  description: 'Trigger a workflow when Windchill document attributes change',
  version: '1.0.0',
  icon: WindchillIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'windchill_document_attributes_changed',
    triggerOptions: windchillTriggerOptions,
    includeDropdown: true,
    setupInstructions: windchillSetupInstructions('document attribute changes'),
    extraFields: buildWindchillExtraFields('windchill_document_attributes_changed'),
  }),
  outputs: {},
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
