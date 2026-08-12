import { WindchillIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildWindchillExtraFields,
  windchillSetupInstructions,
  windchillTriggerOptions,
} from '@/triggers/windchill/utils'

export const windchillDocumentIdentityChangedTrigger: TriggerConfig = {
  id: 'windchill_document_identity_changed',
  name: 'Windchill Document Identity Changed',
  provider: 'windchill',
  description: 'Trigger a workflow when a Windchill document identity changes',
  version: '1.0.0',
  icon: WindchillIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'windchill_document_identity_changed',
    triggerOptions: windchillTriggerOptions,
    setupInstructions: windchillSetupInstructions('document identity changes'),
    extraFields: buildWindchillExtraFields('windchill_document_identity_changed'),
  }),
  outputs: {},
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
