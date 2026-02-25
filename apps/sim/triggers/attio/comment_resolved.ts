import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildCommentOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Comment Resolved Trigger
 *
 * Triggers when a comment thread is resolved in Attio.
 */
export const attioCommentResolvedTrigger: TriggerConfig = {
  id: 'attio_comment_resolved',
  name: 'Attio Comment Resolved',
  provider: 'attio',
  description: 'Trigger workflow when a comment thread is resolved in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_comment_resolved'),

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
