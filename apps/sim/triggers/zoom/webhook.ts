import { ZoomIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildGenericOutputs,
  zoomSecretTokenField,
  zoomSetupInstructions,
  zoomTriggerOptions,
} from '@/triggers/zoom/utils'

/**
 * Generic Zoom webhook trigger that accepts any event type.
 */
export const zoomWebhookTrigger: TriggerConfig = {
  id: 'zoom_webhook',
  name: 'Zoom Webhook (All Events)',
  provider: 'zoom',
  description: 'Trigger workflow on any Zoom webhook event',
  version: '1.0.0',
  icon: ZoomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zoom_webhook',
    triggerOptions: zoomTriggerOptions,
    setupInstructions: zoomSetupInstructions('generic'),
    extraFields: [zoomSecretTokenField('zoom_webhook')],
  }),

  outputs: buildGenericOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
