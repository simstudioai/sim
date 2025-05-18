'use client'

import { useEffect, useState } from 'react'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { SubBlockConfig } from '@/blocks/types'
import { FolderInfo, FolderSelector } from '../folder-selector'

interface FolderSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  value?: string
}

export function FolderSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  value: propValue
}: FolderSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [folderInfo, setFolderInfo] = useState<FolderInfo | null>(null)

  // Get the current value from the store or prop value if in preview mode
  useEffect(() => {
    if (isPreview && propValue !== undefined) {
      setSelectedFolderId(propValue);
    } else {
      const value = getValue(blockId, subBlock.id);
      if (value && typeof value === 'string') {
        setSelectedFolderId(value);
      } else {
        const defaultValue = 'INBOX';
        setSelectedFolderId(defaultValue);
        if (!isPreview) {
          setValue(blockId, subBlock.id, defaultValue);
        }
      }
    }
  }, [blockId, subBlock.id, getValue, setValue, isPreview, propValue]);

  // Handle folder selection
  const handleFolderChange = (folderId: string, info?: FolderInfo) => {
    setSelectedFolderId(folderId);
    setFolderInfo(info || null);
    if (!isPreview) {
      setValue(blockId, subBlock.id, folderId);
    }
  }

  return (
    <FolderSelector
      value={selectedFolderId}
      onChange={handleFolderChange}
      provider={subBlock.provider || 'google-email'}
      requiredScopes={subBlock.requiredScopes || []}
      label={subBlock.placeholder || 'Select folder'}
      disabled={disabled}
      serviceId={subBlock.serviceId}
      onFolderInfoChange={setFolderInfo}
    />
  )
}
