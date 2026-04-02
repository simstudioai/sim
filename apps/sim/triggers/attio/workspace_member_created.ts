import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildWorkspaceMemberOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Attio Workspace Member Created Trigger
 *
 * Triggers when a new member is added to the Attio workspace.
 */
export const attioWorkspaceMemberCreatedTrigger: TriggerConfig = {
  id: 'attio_workspace_member_created',
  name: 'Attio Workspace Member Created',
  provider: 'attio',
  description: 'Trigger workflow when a new member is added to the Attio workspace',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_workspace_member_created'),

  outputs: buildWorkspaceMemberOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
