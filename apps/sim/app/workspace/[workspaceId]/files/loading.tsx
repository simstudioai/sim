'use client'

import { useTranslations } from 'next-intl'
import { File as FilesIcon, FolderPlus, Plus, Upload } from '@/components/emcn'
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  return (
    <ResourceChromeFallback
      icon={FilesIcon}
      title={t('files')}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder={tI18n('search_files')}
      hasSort
      hasFilter
    />
  )
}
