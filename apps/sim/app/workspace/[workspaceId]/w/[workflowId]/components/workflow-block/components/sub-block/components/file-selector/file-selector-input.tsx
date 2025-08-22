'use client'

import { useParams } from 'next/navigation'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getEnv } from '@/lib/env'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import {
  ConfluenceFileSelector,
  DiscordChannelSelector,
  GoogleCalendarSelector,
  GoogleDrivePicker,
  JiraIssueSelector,
  MicrosoftFileSelector,
  TeamsMessageSelector,
  WealthboxFileSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/file-selector/components'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface FileSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled: boolean
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, any>
}

export function FileSelectorInput({
  blockId,
  subBlock,
  disabled,
  isPreview = false,
  previewValue,
  previewContextValues,
}: FileSelectorInputProps) {
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const { activeWorkflowId } = useWorkflowRegistry()
  const params = useParams()
  const workflowIdFromUrl = (params?.workflowId as string) || activeWorkflowId || ''
  // Central dependsOn gating for this selector instance
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, { disabled, isPreview })

  // Helper to coerce various preview value shapes into a string ID
  const coerceToIdString = (val: unknown): string => {
    if (!val) return ''
    if (typeof val === 'string') return val
    if (typeof val === 'number') return String(val)
    if (typeof val === 'object') {
      const obj = val as Record<string, any>
      return (obj.id ||
        obj.fileId ||
        obj.value ||
        obj.documentId ||
        obj.spreadsheetId ||
        '') as string
    }
    return ''
  }

  // Use the proper hook to get the current value and setter
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [connectedCredential] = useSubBlockValue(blockId, 'credential')
  const [domainValue] = useSubBlockValue(blockId, 'domain')
  const [projectIdValue] = useSubBlockValue(blockId, 'projectId')
  const [planIdValue] = useSubBlockValue(blockId, 'planId')
  const [teamIdValue] = useSubBlockValue(blockId, 'teamId')
  const [operationValue] = useSubBlockValue(blockId, 'operation')
  const [serverIdValue] = useSubBlockValue(blockId, 'serverId')
  const [botTokenValue] = useSubBlockValue(blockId, 'botToken')

  // Determine if the persisted credential belongs to the current viewer
  // Use service providerId where available (e.g., onedrive/sharepoint) instead of base provider ("microsoft")
  const foreignCheckProvider = subBlock.serviceId
    ? getProviderIdFromServiceId(subBlock.serviceId)
    : (subBlock.provider as string) || ''
  const { isForeignCredential } = useForeignCredential(
    foreignCheckProvider,
    (connectedCredential as string) || ''
  )

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
  const domain =
    isConfluence || isJira
      ? (isPreview && previewContextValues?.domain?.value) || (domainValue as string) || ''
      : ''
  const jiraCredential = isJira
    ? (isPreview && previewContextValues?.credential?.value) ||
      (connectedCredential as string) ||
      ''
    : ''

  // For Discord, we need the bot token and server ID
  const botToken = isDiscord
    ? (isPreview && previewContextValues?.botToken?.value) || (botTokenValue as string) || ''
    : ''
  const serverId = isDiscord
    ? (isPreview && previewContextValues?.serverId?.value) || (serverIdValue as string) || ''
    : ''

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // For Google Drive
  const clientId = getEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || ''
  const apiKey = getEnv('NEXT_PUBLIC_GOOGLE_API_KEY') || ''

  // Render Google Calendar selector
  if (isGoogleCalendar) {
    const credential = (connectedCredential as string) || ''

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
                onChange={(val) => {
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                label={subBlock.placeholder || 'Select Google Calendar'}
                disabled={finalDisabled}
                showPreview={true}
                credentialId={credential}
                workflowId={workflowIdFromUrl}
              />
            </div>
          </TooltipTrigger>
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
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(channelId) => setStoreValue(channelId)}
                botToken={botToken}
                serverId={serverId}
                label={subBlock.placeholder || 'Select Discord channel'}
                disabled={finalDisabled}
                showPreview={true}
              />
            </div>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Render the appropriate picker based on provider
  if (isConfluence) {
    const credential = (connectedCredential as string) || ''
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
                onChange={(val) => {
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                domain={domain}
                provider='confluence'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Confluence page'}
                disabled={finalDisabled}
                showPreview={true}
                credentialId={credential}
                workflowId={workflowIdFromUrl}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (isJira) {
    const credential = (connectedCredential as string) || ''
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
                onChange={(issueKey) => {
                  collaborativeSetSubblockValue(blockId, subBlock.id, issueKey)
                }}
                domain={domain}
                provider='jira'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Jira issue'}
                disabled={finalDisabled}
                showPreview={true}
                credentialId={credential}
                projectId={(projectIdValue as string) || ''}
                isForeignCredential={isForeignCredential}
                workflowId={activeWorkflowId || ''}
              />
            </div>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (isMicrosoftExcel) {
    const credential = (connectedCredential as string) || ''
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(fileId) => setStoreValue(fileId)}
                provider='microsoft-excel'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Microsoft Excel file'}
                disabled={finalDisabled}
                showPreview={true}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Microsoft Word selector
  if (isMicrosoftWord) {
    const credential = (connectedCredential as string) || ''
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(fileId) => setStoreValue(fileId)}
                provider='microsoft-word'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Microsoft Word document'}
                disabled={finalDisabled}
                showPreview={true}
              />
            </div>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Microsoft OneDrive selector
  if (isMicrosoftOneDrive) {
    const credential = (connectedCredential as string) || ''
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(fileId) => setStoreValue(fileId)}
                provider='microsoft'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select OneDrive folder'}
                disabled={finalDisabled}
                showPreview={true}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Microsoft SharePoint selector
  if (isMicrosoftSharePoint) {
    const credential = (connectedCredential as string) || ''
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(fileId) => setStoreValue(fileId)}
                provider='microsoft'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select SharePoint site'}
                disabled={finalDisabled}
                showPreview={true}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
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

  // Microsoft Planner task selector
  if (isMicrosoftPlanner) {
    const credential = (connectedCredential as string) || ''
    const planId = (planIdValue as string) || ''
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(fileId) => setStoreValue(fileId)}
                provider='microsoft-planner'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId='microsoft-planner'
                label={subBlock.placeholder || 'Select task'}
                disabled={finalDisabled}
                showPreview={true}
                planId={planId}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
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

  // Microsoft Teams selector
  if (isMicrosoftTeams) {
    const credential = (connectedCredential as string) || ''

    // Determine the selector type based on the subBlock ID / operation
    let selectionType: 'team' | 'channel' | 'chat' = 'team'
    if (subBlock.id === 'teamId') selectionType = 'team'
    else if (subBlock.id === 'channelId') selectionType = 'channel'
    else if (subBlock.id === 'chatId') selectionType = 'chat'
    else {
      const operation = (operationValue as string) || ''
      if (operation.includes('chat')) selectionType = 'chat'
      else if (operation.includes('channel')) selectionType = 'channel'
    }

    const selectedTeamId = (teamIdValue as string) || ''

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
                onChange={(val) => {
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                provider='microsoft-teams'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                label={subBlock.placeholder || 'Select Teams message location'}
                disabled={finalDisabled}
                showPreview={true}
                credential={credential}
                selectionType={selectionType}
                initialTeamId={selectedTeamId}
                workflowId={activeWorkflowId || ''}
                isForeignCredential={isForeignCredential}
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

  // Wealthbox selector
  if (isWealthbox) {
    const credential = (connectedCredential as string) || ''
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
                  onChange={(val) => {
                    collaborativeSetSubblockValue(blockId, subBlock.id, val)
                  }}
                  provider='wealthbox'
                  requiredScopes={subBlock.requiredScopes || []}
                  serviceId={subBlock.serviceId}
                  label={subBlock.placeholder || `Select ${itemType}`}
                  disabled={finalDisabled}
                  showPreview={true}
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
    // noteId or taskId now use short-input
    return null
  }

  // Default to Google Drive picker
  {
    const credential = ((isPreview && previewContextValues?.credential?.value) ||
      (connectedCredential as string) ||
      '') as string

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <GoogleDrivePicker
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(val) => {
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                provider={provider}
                requiredScopes={subBlock.requiredScopes || []}
                label={subBlock.placeholder || 'Select file'}
                disabled={finalDisabled}
                serviceId={subBlock.serviceId}
                mimeTypeFilter={subBlock.mimeType}
                showPreview={true}
                clientId={clientId}
                apiKey={apiKey}
                credentialId={credential}
                workflowId={workflowIdFromUrl}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select Google Drive credentials first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }
}
