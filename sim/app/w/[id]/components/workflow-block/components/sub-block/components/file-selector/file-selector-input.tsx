'use client'

import { useEffect, useState } from 'react'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { SubBlockConfig } from '@/blocks/types'
import { ConfluenceFileInfo, ConfluenceFileSelector } from './components/confluence-file-selector'
import { FileInfo, GoogleDrivePicker } from './components/google-drive-picker'

interface FileSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
}

export function FileSelectorInput({ blockId, subBlock, disabled = false }: FileSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
  const [selectedFileId, setSelectedFileId] = useState<string>('')
  const [fileInfo, setFileInfo] = useState<FileInfo | ConfluenceFileInfo | null>(null)

  // Get provider-specific values
  const provider = subBlock.provider || 'google-drive'
  const isConfluence = provider === 'confluence'

  // For Confluence, we need the domain and credentials
  const domain = isConfluence ? (getValue(blockId, 'domain') as string) || '' : ''
  const credentials = isConfluence ? (getValue(blockId, 'credential') as string) || '' : ''

  // Get the current value from the store
  useEffect(() => {
    const value = getValue(blockId, subBlock.id)
    if (value && typeof value === 'string') {
      setSelectedFileId(value)
    }
  }, [blockId, subBlock.id, getValue])

  // Handle file selection
  const handleFileChange = (fileId: string, info?: any) => {
    setSelectedFileId(fileId)
    setFileInfo(info || null)
    setValue(blockId, subBlock.id, fileId)
  }

  // For Google Drive
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || ''

  // Render the appropriate picker based on provider
  if (isConfluence) {
    return (
      <ConfluenceFileSelector
        value={selectedFileId}
        onChange={handleFileChange}
        domain={domain}
        provider="confluence"
        requiredScopes={subBlock.requiredScopes || []}
        serviceId={subBlock.serviceId}
        label={subBlock.placeholder || 'Select Confluence page'}
        disabled={disabled}
        showPreview={true}
        onFileInfoChange={setFileInfo as (info: ConfluenceFileInfo | null) => void}
      />
    )
  }

  // Default to Google Drive picker
  return (
    <GoogleDrivePicker
      value={selectedFileId}
      onChange={handleFileChange}
      provider={provider}
      requiredScopes={subBlock.requiredScopes || []}
      label={subBlock.placeholder || 'Select file'}
      disabled={disabled}
      serviceId={subBlock.serviceId}
      mimeTypeFilter={subBlock.mimeType}
      showPreview={true}
      onFileInfoChange={setFileInfo}
      clientId={clientId}
      apiKey={apiKey}
    />
  )
}
