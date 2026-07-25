import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpListOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupListUpdatedTrigger: TriggerConfig = {
  id: 'clickup_list_updated',
  name: 'ClickUp List Updated',
  provider: 'clickup',
  description: 'Trigger workflow when a list is updated in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_list_updated'),
  outputs: buildClickUpListOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
