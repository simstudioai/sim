import { GongIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildCallOutputs,
  buildGongExtraFields,
  gongSetupInstructions,
  gongTriggerOptions,
} from './utils'

/**
 * Gong Call Completed Trigger
 *
 * Secondary trigger - does NOT include the dropdown (the generic webhook trigger has it).
 * Use this when the workflow is scoped to “completed call” rules; Gong still filters calls in the rule —
 * the payload shape is the same as other call webhooks.
 */
export const gongCallCompletedTrigger: TriggerConfig = {
  id: 'gong_call_completed',
  name: 'Gong Call Completed',
  provider: 'gong',
  description: 'Trigger workflow when a call is completed and processed in Gong',
  version: '1.0.0',
  icon: GongIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gong_call_completed',
    triggerOptions: gongTriggerOptions,
    setupInstructions: gongSetupInstructions('Call Completed'),
    extraFields: buildGongExtraFields('gong_call_completed'),
  }),

  outputs: buildCallOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
