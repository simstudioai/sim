import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildCommentOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Comment Unresolved Trigger
 *
 * Triggers when a comment thread is unresolved in Attio.
 */
export const attioCommentUnresolvedTrigger: TriggerConfig = {
  id: 'attio_comment_unresolved',
  name: 'Attio Comment Unresolved',
  provider: 'attio',
  description: 'Trigger workflow when a comment thread is unresolved in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_comment_unresolved'),

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
