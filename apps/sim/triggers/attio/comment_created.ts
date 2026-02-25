import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildCommentOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Comment Created Trigger
 *
 * Triggers when a comment is created in Attio.
 */
export const attioCommentCreatedTrigger: TriggerConfig = {
  id: 'attio_comment_created',
  name: 'Attio Comment Created',
  provider: 'attio',
  description: 'Trigger workflow when a new comment is created in Attio',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_comment_created'),

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
