import { AttioIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  attioSetupInstructions,
  attioTriggerOptions,
  buildAttioExtraFields,
  buildCommentOutputs,
} from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Comment Deleted Trigger
 *
 * Triggers when a comment is deleted in Attio.
 */
export const attioCommentDeletedTrigger: TriggerConfig = {
  id: 'attio_comment_deleted',
  name: 'Attio Comment Deleted',
  provider: 'attio',
  description: 'Trigger workflow when a comment is deleted in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'attio_comment_deleted',
    triggerOptions: attioTriggerOptions,
    setupInstructions: attioSetupInstructions('comment.deleted'),
    extraFields: buildAttioExtraFields('attio_comment_deleted'),
  }),

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
