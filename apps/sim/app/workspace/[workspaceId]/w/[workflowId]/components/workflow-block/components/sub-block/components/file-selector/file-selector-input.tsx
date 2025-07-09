'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { env } from '@/lib/env'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import type { ConfluenceFileInfo } from './components/confluence-file-selector'
import { ConfluenceFileSelector } from './components/confluence-file-selector'
import type { DiscordChannelInfo } from './components/discord-channel-selector'
import { DiscordChannelSelector } from './components/discord-channel-selector'
import type { GoogleCalendarInfo } from './components/google-calendar-selector'
import { GoogleCalendarSelector } from './components/google-calendar-selector'
import type { FileInfo } from './components/google-drive-picker'
import { GoogleDrivePicker } from './components/google-drive-picker'
import type { JiraIssueInfo } from './components/jira-issue-selector'
import { JiraIssueSelector } from './components/jira-issue-selector'
import type { MicrosoftFileInfo } from './components/microsoft-file-selector'
import { MicrosoftFileSelector } from './components/microsoft-file-selector'
import type { TeamsMessageInfo } from './components/teams-message-selector'
import { TeamsMessageSelector } from './components/teams-message-selector'
import type { WealthboxItemInfo } from './components/wealthbox-file-selector'
import { WealthboxFileSelector } from './components/wealthbox-file-selector'

interface FileSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled: boolean
  isPreview?: boolean
  previewValue?: any | null
}

export function FileSelectorInput({
  blockId,
  subBlock,
  disabled,
  isPreview = false,
  previewValue,
}: FileSelectorInputProps) {
  const { getValue } = useSubBlockStore()
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const { activeWorkflowId } = useWorkflowRegistry()

  // Use the proper hook to get the current value and setter
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [selectedFileId, setSelectedFileId] = useState<string>('')
  const [_fileInfo, setFileInfo] = useState<FileInfo | ConfluenceFileInfo | null>(null)
  const [selectedIssueId, setSelectedIssueId] = useState<string>('')
  const [_issueInfo, setIssueInfo] = useState<JiraIssueInfo | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [channelInfo, setChannelInfo] = useState<DiscordChannelInfo | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string>('')
  const [messageInfo, setMessageInfo] = useState<TeamsMessageInfo | null>(null)
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('')
  const [calendarInfo, setCalendarInfo] = useState<GoogleCalendarInfo | null>(null)
  const [selectedWealthboxItemId, setSelectedWealthboxItemId] = useState<string>('')
  const [wealthboxItemInfo, setWealthboxItemInfo] = useState<WealthboxItemInfo | null>(null)

  // Get provider-specific values
  const provider = subBlock.provider || 'google-drive'
  const isConfluence = provider === 'confluence'
  const isJira = provider === 'jira'
  const isDiscord = provider === 'discord'
  const isMicrosoftTeams = provider === 'microsoft-teams'
  const isMicrosoftExcel = provider === 'microsoft-excel'
  const isGoogleCalendar = subBlock.provider === 'google-calendar'
  const isWealthbox = provider === 'wealthbox'
  // For Confluence and Jira, we need the domain and credentials
  const domain = isConfluence || isJira ? (getValue(blockId, 'domain') as string) || '' : ''
  // For Discord, we need the bot token and server ID
  const botToken = isDiscord ? (getValue(blockId, 'botToken') as string) || '' : ''
  const serverId = isDiscord ? (getValue(blockId, 'serverId') as string) || '' : ''

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Get the current value from the store or prop value if in preview mode
  useEffect(() => {
    if (isPreview && previewValue !== undefined) {
      const value = previewValue
      if (value && typeof value === 'string') {
        if (isJira) {
          setSelectedIssueId(value)
        } else if (isDiscord) {
          setSelectedChannelId(value)
        } else if (isMicrosoftTeams) {
          setSelectedMessageId(value)
        } else if (isGoogleCalendar) {
          setSelectedCalendarId(value)
        } else if (isWealthbox) {
          setSelectedWealthboxItemId(value)
        } else {
          setSelectedFileId(value)
        }
      }
    } else {
      const value = getValue(blockId, subBlock.id)
      if (value && typeof value === 'string') {
        if (isJira) {
          setSelectedIssueId(value)
        } else if (isDiscord) {
          setSelectedChannelId(value)
        } else if (isMicrosoftTeams) {
          setSelectedMessageId(value)
        } else if (isGoogleCalendar) {
          setSelectedCalendarId(value)
        } else if (isWealthbox) {
          setSelectedWealthboxItemId(value)
        } else {
          setSelectedFileId(value)
        }
      }
    }
  }, [
    blockId,
    subBlock.id,
    getValue,
    isJira,
    isDiscord,
    isMicrosoftTeams,
    isGoogleCalendar,
    isWealthbox,
    isPreview,
    previewValue,
  ])

  // Handle file selection
  const handleFileChange = (fileId: string, info?: any) => {
    setSelectedFileId(fileId)
    setFileInfo(info || null)
    setStoreValue(fileId)
  }

  // Handle issue selection
  const handleIssueChange = (issueKey: string, info?: JiraIssueInfo) => {
    setSelectedIssueId(issueKey)
    setIssueInfo(info || null)
    setStoreValue(issueKey)

    // Clear the fields when a new issue is selected
    if (isJira) {
      collaborativeSetSubblockValue(blockId, 'summary', '')
      collaborativeSetSubblockValue(blockId, 'description', '')
    }
  }

  // Handle channel selection
  const handleChannelChange = (channelId: string, info?: DiscordChannelInfo) => {
    setSelectedChannelId(channelId)
    setChannelInfo(info || null)
    setStoreValue(channelId)
  }

  // Handle calendar selection
  const handleCalendarChange = (calendarId: string, info?: GoogleCalendarInfo) => {
    setSelectedCalendarId(calendarId)
    setCalendarInfo(info || null)
    setStoreValue(calendarId)
  }

  // Handle Wealthbox item selection
  const handleWealthboxItemChange = (itemId: string, info?: WealthboxItemInfo) => {
    setSelectedWealthboxItemId(itemId)
    setWealthboxItemInfo(info || null)
    setStoreValue(itemId)
  }

  // For Google Drive
  const clientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  const apiKey = env.NEXT_PUBLIC_GOOGLE_API_KEY || ''

  // Render Google Calendar selector
  if (isGoogleCalendar) {
    const credential = (getValue(blockId, 'credential') as string) || ''

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <GoogleCalendarSelector
                value={selectedCalendarId}
                onChange={handleCalendarChange}
                label={subBlock.placeholder || 'Select Google Calendar'}
                disabled={disabled || !credential}
                showPreview={true}
                onCalendarInfoChange={setCalendarInfo}
                credentialId={credential}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select Google Calendar credentials first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Render Discord channel selector
  if (isDiscord) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
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
            <TooltipContent side='top'>
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
            <div className='w-full'>
              <ConfluenceFileSelector
                value={selectedFileId}
                onChange={handleFileChange}
                domain={domain}
                provider='confluence'
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
            <TooltipContent side='top'>
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
            <div className='w-full'>
              <JiraIssueSelector
                value={selectedIssueId}
                onChange={handleIssueChange}
                domain={domain}
                provider='jira'
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
            <TooltipContent side='top'>
              <p>Please enter a Jira domain first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (isMicrosoftExcel) {
    // Get credential using the same pattern as other tools
    const credential = (getValue(blockId, 'credential') as string) || ''

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={selectedFileId}
                onChange={handleFileChange}
                provider='microsoft-excel'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Microsoft Excel file'}
                disabled={disabled || !credential}
                showPreview={true}
                onFileInfoChange={setFileInfo as (info: MicrosoftFileInfo | null) => void}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select Microsoft Excel credentials first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Handle Microsoft Teams selector
  if (isMicrosoftTeams) {
    // Get credential using the same pattern as other tools
    const credential = (getValue(blockId, 'credential') as string) || ''

    // Determine the selector type based on the subBlock ID
    let selectionType: 'team' | 'channel' | 'chat' = 'team'

    if (subBlock.id === 'teamId') {
      selectionType = 'team'
    } else if (subBlock.id === 'channelId') {
      selectionType = 'channel'
    } else if (subBlock.id === 'chatId') {
      selectionType = 'chat'
    } else {
      // Fallback: look at the operation to determine the selection type
      const operation = (getValue(blockId, 'operation') as string) || ''
      if (operation.includes('chat')) {
        selectionType = 'chat'
      } else if (operation.includes('channel')) {
        selectionType = 'channel'
      }
    }

    // Get the teamId from workflow parameters for channel selector
    const selectedTeamId = (getValue(blockId, 'teamId') as string) || ''

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <TeamsMessageSelector
                value={selectedMessageId}
                onChange={(value, info) => {
                  setSelectedMessageId(value)
                  setMessageInfo(info || null)
                  collaborativeSetSubblockValue(blockId, subBlock.id, value)
                }}
                provider='microsoft-teams'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Teams message location'}
                disabled={disabled || !credential}
                showPreview={true}
                onMessageInfoChange={setMessageInfo}
                credential={credential}
                selectionType={selectionType}
                initialTeamId={selectedTeamId}
                workflowId={activeWorkflowId || ''}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select Microsoft Teams credentials first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Render Wealthbox selector
  if (isWealthbox) {
    // Get credential using the same pattern as other tools
    const credential = (getValue(blockId, 'credential') as string) || ''

    // Only handle contacts now - both notes and tasks use short-input
    if (subBlock.id === 'contactId') {
      const itemType = 'contact'

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className='w-full'>
                <WealthboxFileSelector
                  value={selectedWealthboxItemId}
                  onChange={handleWealthboxItemChange}
                  provider='wealthbox'
                  requiredScopes={subBlock.requiredScopes || []}
                  serviceId={subBlock.serviceId}
                  label={subBlock.placeholder || `Select ${itemType}`}
                  disabled={disabled || !credential}
                  showPreview={true}
                  onFileInfoChange={setWealthboxItemInfo}
                  itemType={itemType}
                />
              </div>
            </TooltipTrigger>
            {!credential && (
              <TooltipContent side='top'>
                <p>Please select Wealthbox credentials first</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )
    }
    // If it's noteId or taskId, we should not render the file selector since they now use short-input
    return null
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
