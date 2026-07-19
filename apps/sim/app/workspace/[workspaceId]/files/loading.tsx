'use client'

import { File as FilesIcon, FolderPlus, Plus, Upload } from '@sim/emcn'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 1.15 },
  { id: 'size', header: 'Size', widthMultiplier: 0.85 },
  { id: 'type', header: 'Type', widthMultiplier: 1.0 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const ACTIONS: ChromeActionSpec[] = [
  { text: 'Upload', icon: Upload },
  { text: 'New folder', icon: FolderPlus },
  { text: 'New file', icon: Plus, variant: 'primary' },
]

export default function FilesLoading() {
  return (
    <ResourceChromeFallback
      icon={FilesIcon}
      title='Files'
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search files...'
      hasSort
      hasFilter
    />
  )
}
