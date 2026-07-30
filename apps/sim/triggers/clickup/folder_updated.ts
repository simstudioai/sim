import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpFolderOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupFolderUpdatedTrigger: TriggerConfig = {
  id: 'clickup_folder_updated',
  name: 'ClickUp Folder Updated',
  provider: 'clickup',
  description: 'Trigger workflow when a folder is updated in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_folder_updated'),
  outputs: buildClickUpFolderOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
