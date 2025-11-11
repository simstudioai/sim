'use client'

import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { getEnv } from '@/lib/env'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import {
  ConfluenceFileSelector,
  GoogleCalendarSelector,
  GoogleDrivePicker,
  JiraIssueSelector,
  MicrosoftFileSelector,
  TeamsMessageSelector,
  WealthboxFileSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/file-selector/components'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
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
  const { finalDisabled, dependsOn } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

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
  const [connectedCredentialFromStore] = useSubBlockValue(blockId, 'credential')
  const [domainValueFromStore] = useSubBlockValue(blockId, 'domain')
  const [projectIdValueFromStore] = useSubBlockValue(blockId, 'projectId')
  const [planIdValueFromStore] = useSubBlockValue(blockId, 'planId')
  const [teamIdValueFromStore] = useSubBlockValue(blockId, 'teamId')
  const [operationValueFromStore] = useSubBlockValue(blockId, 'operation')

  // Use previewContextValues if provided (for tools inside agent blocks), otherwise use store values
  const connectedCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const domainValue = previewContextValues?.domain ?? domainValueFromStore
  const projectIdValue = previewContextValues?.projectId ?? projectIdValueFromStore
  const planIdValue = previewContextValues?.planId ?? planIdValueFromStore
  const teamIdValue = previewContextValues?.teamId ?? teamIdValueFromStore
  const operationValue = previewContextValues?.operation ?? operationValueFromStore

  // Determine if the persisted credential belongs to the current viewer
  // Use service providerId where available (e.g., onedrive/sharepoint) instead of base provider ("microsoft")
  const foreignCheckProvider = subBlock.serviceId
    ? getProviderIdFromServiceId(subBlock.serviceId)
    : (subBlock.provider as string) || ''
  const { isForeignCredential } = useForeignCredential(
    subBlock.provider || subBlock.serviceId || 'outlook',
    (connectedCredential as string) || ''
  )

  // Get provider-specific values
  const provider = subBlock.provider || 'google-drive'
  const isConfluence = provider === 'confluence'
  const isJira = provider === 'jira'
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

  // Discord channel selector removed; no special values used here

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  const credentialDependencySatisfied = (() => {
    if (!dependsOn.includes('credential')) return true
    const normalizedCredential = coerceToIdString(connectedCredential)
    if (!normalizedCredential || normalizedCredential.trim().length === 0) {
      return false
    }
    if (isForeignCredential) {
      return false
    }
    return true
  })()

  const shouldForceDisable = !credentialDependencySatisfied

  // For Google Drive
  const clientId = getEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || ''
  const apiKey = getEnv('NEXT_PUBLIC_GOOGLE_API_KEY') || ''

  // Render Google Calendar selector
  if (isGoogleCalendar) {
    const credential = (connectedCredential as string) || ''

    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div className='w-full'>
              <GoogleCalendarSelector
                value={
                  (isPreview && previewValue !== undefined
                    ? (previewValue as string)
                    : (storeValue as string)) || ''
                }
                onChange={(val: string) => {
                  collaborativeSetSubblockValue(blockId, subBlock.id, val)
                }}
                label={subBlock.placeholder || 'Select Google Calendar'}
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                credentialId={credential}
                workflowId={workflowIdFromUrl}
              />
            </div>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  // Render the appropriate picker based on provider
  if (isConfluence) {
    const credential = (connectedCredential as string) || ''
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                credentialId={credential}
                workflowId={workflowIdFromUrl}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  if (isJira) {
    const credential = (connectedCredential as string) || ''
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                credentialId={credential}
                projectId={(projectIdValue as string) || ''}
                isForeignCredential={isForeignCredential}
                workflowId={activeWorkflowId || ''}
              />
            </div>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  if (isMicrosoftExcel) {
    const credential = (connectedCredential as string) || ''
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  // Microsoft Word selector
  if (isMicrosoftWord) {
    const credential = (connectedCredential as string) || ''
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
              />
            </div>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  // Microsoft OneDrive selector
  if (isMicrosoftOneDrive) {
    const credential = (connectedCredential as string) || ''
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div className='w-full'>
              <MicrosoftFileSelector
                value={coerceToIdString(
                  (isPreview && previewValue !== undefined ? previewValue : storeValue) as any
                )}
                onChange={(fileId) => setStoreValue(fileId)}
                provider='microsoft'
                requiredScopes={subBlock.requiredScopes || []}
                serviceId={subBlock.serviceId}
                mimeType={subBlock.mimeType}
                label={subBlock.placeholder || 'Select OneDrive folder'}
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  // Microsoft SharePoint selector
  if (isMicrosoftSharePoint) {
    const credential = (connectedCredential as string) || ''
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </Tooltip.Trigger>
          {!credential && (
            <Tooltip.Content side='top'>
              <p>Please select SharePoint credentials first</p>
            </Tooltip.Content>
          )}
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  // Microsoft Planner task selector
  if (isMicrosoftPlanner) {
    const credential = (connectedCredential as string) || ''
    const planId = (planIdValue as string) || ''
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                planId={planId}
                workflowId={activeWorkflowId || ''}
                credentialId={credential}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </Tooltip.Trigger>
          {!credential ? (
            <Tooltip.Content side='top'>
              <p>Please select Microsoft Planner credentials first</p>
            </Tooltip.Content>
          ) : !planId ? (
            <Tooltip.Content side='top'>
              <p>Please enter a Plan ID first</p>
            </Tooltip.Content>
          ) : null}
        </Tooltip.Root>
      </Tooltip.Provider>
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
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                showPreview={true}
                credential={credential}
                selectionType={selectionType}
                initialTeamId={selectedTeamId}
                workflowId={activeWorkflowId || ''}
                isForeignCredential={isForeignCredential}
              />
            </div>
          </Tooltip.Trigger>
          {!credential && (
            <Tooltip.Content side='top'>
              <p>Please select Microsoft Teams credentials first</p>
            </Tooltip.Content>
          )}
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  // Wealthbox selector
  if (isWealthbox) {
    const credential = (connectedCredential as string) || ''
    if (subBlock.id === 'contactId') {
      const itemType = 'contact'
      return (
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
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
                  disabled={finalDisabled || shouldForceDisable}
                  showPreview={true}
                  credentialId={credential}
                  itemType={itemType}
                />
              </div>
            </Tooltip.Trigger>
            {!credential && (
              <Tooltip.Content side='top'>
                <p>Please select Wealthbox credentials first</p>
              </Tooltip.Content>
            )}
          </Tooltip.Root>
        </Tooltip.Provider>
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
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
                disabled={finalDisabled || shouldForceDisable}
                serviceId={subBlock.serviceId}
                mimeTypeFilter={subBlock.mimeType}
                showPreview={true}
                clientId={clientId}
                apiKey={apiKey}
                credentialId={credential}
                workflowId={workflowIdFromUrl}
              />
            </div>
          </Tooltip.Trigger>
          {!credential && (
            <Tooltip.Content side='top'>
              <p>Please select Google Drive credentials first</p>
            </Tooltip.Content>
          )}
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }
}
