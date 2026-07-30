import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpSpaceOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupSpaceDeletedTrigger: TriggerConfig = {
  id: 'clickup_space_deleted',
  name: 'ClickUp Space Deleted',
  provider: 'clickup',
  description: 'Trigger workflow when a space is deleted in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_space_deleted'),
  outputs: buildClickUpSpaceOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
