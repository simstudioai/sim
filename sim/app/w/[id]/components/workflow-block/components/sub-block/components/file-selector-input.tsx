'use client'

import { useEffect, useState } from 'react'
import { FileInfo, FileSelector } from '@/components/ui/file-selector'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { SubBlockConfig } from '@/blocks/types'

interface FileSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
}

export function FileSelectorInput({ blockId, subBlock, disabled = false }: FileSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
  const [selectedFileId, setSelectedFileId] = useState<string>('')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)

  // Get the current value from the store
  useEffect(() => {
    const value = getValue(blockId, subBlock.id)
    if (value && typeof value === 'string') {
      setSelectedFileId(value)
    }
  }, [blockId, subBlock.id, getValue])

  // Handle file selection
  const handleFileChange = (fileId: string, info?: FileInfo) => {
    setSelectedFileId(fileId)
    setFileInfo(info || null)
    setValue(blockId, subBlock.id, fileId)
  }

  return (
    <FileSelector
      value={selectedFileId}
      onChange={handleFileChange}
      provider={subBlock.provider || 'google-drive'}
      requiredScopes={subBlock.requiredScopes || []}
      label={subBlock.placeholder || 'Select file'}
      disabled={disabled}
      serviceId={subBlock.serviceId}
      mimeTypeFilter={subBlock.mimeType}
      showPreview={true}
      onFileInfoChange={setFileInfo}
    />
  )
}
