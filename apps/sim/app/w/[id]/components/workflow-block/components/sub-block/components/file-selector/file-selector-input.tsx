'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { SubBlockConfig } from '@/blocks/types'
import { ConfluenceFileInfo, ConfluenceFileSelector } from './components/confluence-file-selector'
import { DiscordChannelInfo, DiscordChannelSelector } from './components/discord-channel-selector'
import { FileInfo, GoogleDrivePicker } from './components/google-drive-picker'
import { JiraIssueInfo, JiraIssueSelector } from './components/jira-issue-selector'

interface FileSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
}

export function FileSelectorInput({ blockId, subBlock, disabled = false }: FileSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
  const [selectedFileId, setSelectedFileId] = useState<string>('')
  const [fileInfo, setFileInfo] = useState<FileInfo | ConfluenceFileInfo | null>(null)
  const [selectedIssueId, setSelectedIssueId] = useState<string>('')
  const [issueInfo, setIssueInfo] = useState<JiraIssueInfo | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [channelInfo, setChannelInfo] = useState<DiscordChannelInfo | null>(null)

  // Get provider-specific values
  const provider = subBlock.provider || 'google-drive'
  const isConfluence = provider === 'confluence'
  const isJira = provider === 'jira'
  const isDiscord = provider === 'discord'

  // For Confluence and Jira, we need the domain and credentials
  const domain = isConfluence || isJira ? (getValue(blockId, 'domain') as string) || '' : ''
  const credentials =
    isConfluence || isJira ? (getValue(blockId, 'credential') as string) || '' : ''
  // For Discord, we need the bot token and server ID
  const botToken = isDiscord ? (getValue(blockId, 'botToken') as string) || '' : ''
  const serverId = isDiscord ? (getValue(blockId, 'serverId') as string) || '' : ''

  // Get the current value from the store
  useEffect(() => {
    const value = getValue(blockId, subBlock.id)
    if (value && typeof value === 'string') {
      if (isJira) {
        setSelectedIssueId(value)
      } else if (isDiscord) {
        setSelectedChannelId(value)
      } else {
        setSelectedFileId(value)
      }
    }
  }, [blockId, subBlock.id, getValue, isJira, isDiscord])

  // Handle file selection
  const handleFileChange = (fileId: string, info?: any) => {
    setSelectedFileId(fileId)
    setFileInfo(info || null)
    setValue(blockId, subBlock.id, fileId)
  }

  // Handle issue selection
  const handleIssueChange = (issueKey: string, info?: JiraIssueInfo) => {
    setSelectedIssueId(issueKey)
    setIssueInfo(info || null)
    setValue(blockId, subBlock.id, issueKey)

    // Clear the fields when a new issue is selected
    if (isJira) {
      setValue(blockId, 'summary', '')
      setValue(blockId, 'description', '')
    }
  }

  // Handle channel selection
  const handleChannelChange = (channelId: string, info?: DiscordChannelInfo) => {
    setSelectedChannelId(channelId)
    setChannelInfo(info || null)
    setValue(blockId, subBlock.id, channelId)
  }

  // For Google Drive
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || ''

  // Render Discord channel selector
  if (isDiscord) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full">
              <DiscordChannelSelector
                value={selectedChannelId}
                onChange={handleChannelChange}
                botToken={botToken}
                serverId={serverId}
                label={subBlock.placeholder || 'Select Discord channel'}
                disabled={disabled || !botToken || !serverId}
                showPreview={true}
              />
            </div>
          </TooltipTrigger>
          {(!botToken || !serverId) && (
            <TooltipContent side="top">
              <p>{!botToken ? 'Please enter a Bot Token first' : 'Please select a Server first'}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Render the appropriate picker based on provider
  if (isConfluence) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full">
              <ConfluenceFileSelector
                value={selectedFileId}
                onChange={handleFileChange}
                domain={domain}
                provider="confluence"
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Confluence page'}
                disabled={disabled || !domain}
                showPreview={true}
                onFileInfoChange={setFileInfo as (info: ConfluenceFileInfo | null) => void}
              />
            </div>
          </TooltipTrigger>
          {!domain && (
            <TooltipContent side="top">
              <p>Please enter a Confluence domain first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (isJira) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full">
              <JiraIssueSelector
                value={selectedIssueId}
                onChange={handleIssueChange}
                domain={domain}
                provider="jira"
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Jira issue'}
                disabled={disabled || !domain}
                showPreview={true}
                onIssueInfoChange={setIssueInfo as (info: JiraIssueInfo | null) => void}
              />
            </div>
          </TooltipTrigger>
          {!domain && (
            <TooltipContent side="top">
              <p>Please enter a Jira domain first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
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
