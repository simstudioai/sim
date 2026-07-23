import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpFolderOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupFolderCreatedTrigger: TriggerConfig = {
  id: 'clickup_folder_created',
  name: 'ClickUp Folder Created',
  provider: 'clickup',
  description: 'Trigger workflow when a folder is created in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_folder_created'),
  outputs: buildClickUpFolderOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
