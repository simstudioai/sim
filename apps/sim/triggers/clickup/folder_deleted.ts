import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpFolderOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupFolderDeletedTrigger: TriggerConfig = {
  id: 'clickup_folder_deleted',
  name: 'ClickUp Folder Deleted',
  provider: 'clickup',
  description: 'Trigger workflow when a folder is deleted in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_folder_deleted'),
  outputs: buildClickUpFolderOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
