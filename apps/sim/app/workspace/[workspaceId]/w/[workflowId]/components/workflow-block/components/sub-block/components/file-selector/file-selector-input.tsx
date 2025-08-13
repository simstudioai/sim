'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getEnv } from '@/lib/env'
import {
  type ConfluenceFileInfo,
  ConfluenceFileSelector,
  type DiscordChannelInfo,
  DiscordChannelSelector,
  type FileInfo,
  type GoogleCalendarInfo,
  GoogleCalendarSelector,
  GoogleDrivePicker,
  type JiraIssueInfo,
  JiraIssueSelector,
  type MicrosoftFileInfo,
  MicrosoftFileSelector,
  type TeamsMessageInfo,
  TeamsMessageSelector,
  WealthboxFileSelector,
  type WealthboxItemInfo,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/file-selector/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

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
  const params = useParams()
  const workflowIdFromUrl = (params?.workflowId as string) || activeWorkflowId || ''

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

  // Determine if the persisted credential belongs to the current viewer
  const [isForeignCredential, setIsForeignCredential] = useState<boolean>(false)
  useEffect(() => {
    const cred = (getValue(blockId, 'credential') as string) || ''
    if (!cred) {
      setIsForeignCredential(false)
      return
    }
    let aborted = false
    ;(async () => {
      try {
        const resp = await fetch(`/api/auth/oauth/credentials?credentialId=${cred}`)
        if (aborted) return
        if (!resp.ok) {
          setIsForeignCredential(true)
          return
        }
        const data = await resp.json()
        // If credential not returned for this session user, it's foreign
        setIsForeignCredential(!(data.credentials && data.credentials.length === 1))
      } catch {
        setIsForeignCredential(true)
      }
    })()
    return () => {
      aborted = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, getValue(blockId, 'credential')])

  // Get provider-specific values
  const provider = subBlock.provider || 'google-drive'
  const isConfluence = provider === 'confluence'
  const isJira = provider === 'jira'
  const isDiscord = provider === 'discord'
  const isMicrosoftTeams = provider === 'microsoft-teams'
  const isMicrosoftExcel = provider === 'microsoft-excel'
  const isMicrosoftWord = provider === 'microsoft-word'
  const isMicrosoftOneDrive = provider === 'microsoft' && subBlock.serviceId === 'onedrive'
  const isGoogleCalendar = subBlock.provider === 'google-calendar'
  const isWealthbox = provider === 'wealthbox'
  const isMicrosoftSharePoint = provider === 'microsoft' && subBlock.serviceId === 'sharepoint'
  const isMicrosoftPlanner = provider === 'microsoft-planner'
  // For Confluence and Jira, we need the domain and credentials
  const domain = isConfluence || isJira ? (getValue(blockId, 'domain') as string) || '' : ''
  const jiraCredential = isJira ? (getValue(blockId, 'credential') as string) || '' : ''
  // For Discord, we need the bot token and server ID
  const botToken = isDiscord ? (getValue(blockId, 'botToken') as string) || '' : ''
  const serverId = isDiscord ? (getValue(blockId, 'serverId') as string) || '' : ''

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Keep local selection in sync with store value (and preview)
  useEffect(() => {
    const effective = isPreview && previewValue !== undefined ? previewValue : storeValue
    if (typeof effective === 'string' && effective !== '') {
      if (isJira) {
        setSelectedIssueId(effective)
      } else if (isDiscord) {
        setSelectedChannelId(effective)
      } else if (isMicrosoftTeams) {
        setSelectedMessageId(effective)
      } else if (isGoogleCalendar) {
        setSelectedCalendarId(effective)
      } else if (isWealthbox) {
        setSelectedWealthboxItemId(effective)
      } else if (isMicrosoftSharePoint) {
        setSelectedFileId(effective)
      } else {
        setSelectedFileId(effective)
      }
    } else {
      // Clear when value becomes empty
      if (isJira) {
        setSelectedIssueId('')
      } else if (isDiscord) {
        setSelectedChannelId('')
      } else if (isMicrosoftTeams) {
        setSelectedMessageId('')
      } else if (isGoogleCalendar) {
        setSelectedCalendarId('')
      } else if (isWealthbox) {
        setSelectedWealthboxItemId('')
      } else if (isMicrosoftSharePoint) {
        setSelectedFileId('')
      } else {
        setSelectedFileId('')
      }
    }
  }, [
    isPreview,
    previewValue,
    storeValue,
    isJira,
    isDiscord,
    isMicrosoftTeams,
    isGoogleCalendar,
    isWealthbox,
    isMicrosoftSharePoint,
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
      if (!issueKey) {
        // Also clear the manual issue key when cleared
        collaborativeSetSubblockValue(blockId, 'manualIssueKey', '')
      }
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
  const clientId = getEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || ''
  const apiKey = getEnv('NEXT_PUBLIC_GOOGLE_API_KEY') || ''

  // Render Google Calendar selector
  if (isGoogleCalendar) {
    const credential = (getValue(blockId, 'credential') as string) || ''

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <GoogleCalendarSelector
                value={
                  (isPreview && previewValue !== undefined
                    ? (previewValue as string)
                    : (storeValue as string)) || ''
                }
                onChange={(val, info) => {
                  setSelectedCalendarId(val)
                  setCalendarInfo(info || null)
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                label={subBlock.placeholder || 'Select Google Calendar'}
                disabled={disabled || !credential}
                showPreview={true}
                onCalendarInfoChange={setCalendarInfo}
                credentialId={credential}
                workflowId={workflowIdFromUrl}
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
    const credential = (getValue(blockId, 'credential') as string) || ''
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <ConfluenceFileSelector
                value={
                  (isPreview && previewValue !== undefined
                    ? (previewValue as string)
                    : (storeValue as string)) || ''
                }
                onChange={(val, info) => {
                  setSelectedFileId(val)
                  setFileInfo(info || null)
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                domain={domain}
                provider='confluence'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Confluence page'}
                disabled={disabled || !domain}
                showPreview={true}
                onFileInfoChange={setFileInfo as (info: ConfluenceFileInfo | null) => void}
                credentialId={credential}
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
    const credential = jiraCredential
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <JiraIssueSelector
                value={
                  (isPreview && previewValue !== undefined
                    ? (previewValue as string)
                    : (storeValue as string)) || ''
                }
                onChange={(val, info) => {
                  setSelectedIssueId(val)
                  setIssueInfo(info || null)
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                domain={domain}
                provider='jira'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Jira issue'}
                disabled={
                  disabled || !domain || !credential || !(getValue(blockId, 'projectId') as string)
                }
                showPreview={true}
                onIssueInfoChange={setIssueInfo as (info: JiraIssueInfo | null) => void}
                credentialId={credential}
                projectId={(getValue(blockId, 'projectId') as string) || ''}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </TooltipTrigger>
          {!domain ? (
            <TooltipContent side='top'>
              <p>Please enter a Jira domain first</p>
            </TooltipContent>
          ) : !credential ? (
            <TooltipContent side='top'>
              <p>Please select Jira credentials first</p>
            </TooltipContent>
          ) : !(getValue(blockId, 'projectId') as string) ? (
            <TooltipContent side='top'>
              <p>Please select a Jira project first</p>
            </TooltipContent>
          ) : null}
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

  // Handle Microsoft Word selector
  if (isMicrosoftWord) {
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
                provider='microsoft-word'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Microsoft Word document'}
                disabled={disabled || !credential}
                showPreview={true}
                onFileInfoChange={setFileInfo as (info: MicrosoftFileInfo | null) => void}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select Microsoft Word credentials first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Handle Microsoft OneDrive selector
  if (isMicrosoftOneDrive) {
    const credential = (getValue(blockId, 'credential') as string) || ''

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={selectedFileId}
                onChange={handleFileChange}
                provider='microsoft'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select OneDrive folder'}
                disabled={disabled || !credential}
                showPreview={true}
                onFileInfoChange={setFileInfo as (info: MicrosoftFileInfo | null) => void}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select Microsoft credentials first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Handle Microsoft SharePoint selector
  if (isMicrosoftSharePoint) {
    const credential = (getValue(blockId, 'credential') as string) || ''

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={selectedFileId}
                onChange={handleFileChange}
                provider='microsoft'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select SharePoint site'}
                disabled={disabled || !credential}
                showPreview={true}
                onFileInfoChange={setFileInfo as (info: MicrosoftFileInfo | null) => void}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select SharePoint credentials first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Handle Microsoft Planner task selector
  if (isMicrosoftPlanner) {
    const credential = (getValue(blockId, 'credential') as string) || ''
    const planId = (getValue(blockId, 'planId') as string) || ''

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={selectedFileId}
                onChange={handleFileChange}
                provider='microsoft-planner'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId='microsoft-planner'
                label={subBlock.placeholder || 'Select task'}
                disabled={disabled || !credential || !planId}
                showPreview={true}
                onFileInfoChange={setFileInfo as (info: MicrosoftFileInfo | null) => void}
                planId={planId}
              />
            </div>
          </TooltipTrigger>
          {!credential ? (
            <TooltipContent side='top'>
              <p>Please select Microsoft Planner credentials first</p>
            </TooltipContent>
          ) : !planId ? (
            <TooltipContent side='top'>
              <p>Please enter a Plan ID first</p>
            </TooltipContent>
          ) : null}
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
                value={
                  (isPreview && previewValue !== undefined
                    ? (previewValue as string)
                    : (storeValue as string)) || ''
                }
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
                  value={
                    (isPreview && previewValue !== undefined
                      ? (previewValue as string)
                      : (storeValue as string)) || ''
                  }
                  onChange={(val, info) => {
                    setSelectedWealthboxItemId(val)
                    setWealthboxItemInfo(info || null)
                    collaborativeSetSubblockValue(blockId, subBlock.id, val)
                  }}
                  provider='wealthbox'
                  requiredScopes={subBlock.requiredScopes || []}
                  serviceId={subBlock.serviceId}
                  label={subBlock.placeholder || `Select ${itemType}`}
                  disabled={disabled || !credential}
                  showPreview={true}
                  onFileInfoChange={setWealthboxItemInfo}
                  credentialId={credential}
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
      value={
        (isPreview && previewValue !== undefined
          ? (previewValue as string)
          : (storeValue as string)) || ''
      }
      onChange={(val, info) => {
        setSelectedFileId(val)
        setFileInfo(info || null)
        collaborativeSetSubblockValue(blockId, subBlock.id, val)
      }}
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
      credentialId={(getValue(blockId, 'credential') as string) || ''}
      workflowId={workflowIdFromUrl}
    />
  )
}
