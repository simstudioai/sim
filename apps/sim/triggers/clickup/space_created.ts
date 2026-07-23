import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpSpaceOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupSpaceCreatedTrigger: TriggerConfig = {
  id: 'clickup_space_created',
  name: 'ClickUp Space Created',
  provider: 'clickup',
  description: 'Trigger workflow when a space is created in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_space_created'),
  outputs: buildClickUpSpaceOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
