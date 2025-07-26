'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type DiscordServerInfo,
  DiscordServerSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/project-selector/components/discord-server-selector'
import {
  type JiraProjectInfo,
  JiraProjectSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/project-selector/components/jira-project-selector'
import {
  type LinearProjectInfo,
  LinearProjectSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/project-selector/components/linear-project-selector'
import {
  type LinearTeamInfo,
  LinearTeamSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/project-selector/components/linear-team-selector'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface ProjectSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onProjectSelect?: (projectId: string) => void
  isPreview?: boolean
  previewValue?: any | null
}

export function ProjectSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onProjectSelect,
  isPreview = false,
  previewValue,
}: ProjectSelectorInputProps) {
  const { getValue } = useSubBlockStore()
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [_projectInfo, setProjectInfo] = useState<JiraProjectInfo | DiscordServerInfo | null>(null)

  // Use the proper hook to get the current value and setter
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Get provider-specific values
  const provider = subBlock.provider || 'jira'
  const isDiscord = provider === 'discord'
  const isLinear = provider === 'linear'

  // For Jira, we need the domain
  const domain = !isDiscord ? (getValue(blockId, 'domain') as string) || '' : ''
  const botToken = isDiscord ? (getValue(blockId, 'botToken') as string) || '' : ''

  // Get the current value from the store or prop value if in preview mode
  useEffect(() => {
    if (isPreview && previewValue !== undefined) {
      setSelectedProjectId(previewValue)
    } else {
      const value = getValue(blockId, subBlock.id)
      if (value && typeof value === 'string') {
        setSelectedProjectId(value)
      }
    }
  }, [blockId, subBlock.id, getValue, isPreview, previewValue])

  // Handle project selection
  const handleProjectChange = (
    projectId: string,
    info?: JiraProjectInfo | DiscordServerInfo | LinearTeamInfo | LinearProjectInfo
  ) => {
    setSelectedProjectId(projectId)
    setProjectInfo(info || null)
    setStoreValue(projectId)

    // Clear the issue-related fields when a new project is selected
    if (provider === 'jira') {
      collaborativeSetSubblockValue(blockId, 'summary', '')
      collaborativeSetSubblockValue(blockId, 'description', '')
      collaborativeSetSubblockValue(blockId, 'issueKey', '')
    } else if (provider === 'discord') {
      collaborativeSetSubblockValue(blockId, 'channelId', '')
    } else if (provider === 'linear') {
      if (subBlock.id === 'teamId') {
        collaborativeSetSubblockValue(blockId, 'teamId', projectId)
        collaborativeSetSubblockValue(blockId, 'projectId', '')
      } else if (subBlock.id === 'projectId') {
        collaborativeSetSubblockValue(blockId, 'projectId', projectId)
      }
    }

    onProjectSelect?.(projectId)
  }

  // Render Discord server selector if provider is discord
  if (isDiscord) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              <DiscordServerSelector
                value={selectedProjectId}
                onChange={(serverId: string, serverInfo?: DiscordServerInfo) => {
                  handleProjectChange(serverId, serverInfo)
                }}
                botToken={botToken}
                label={subBlock.placeholder || 'Select Discord server'}
                disabled={disabled || !botToken}
                showPreview={true}
              />
            </div>
          </TooltipTrigger>
          {!botToken && (
            <TooltipContent side='top'>
              <p>Please enter a Bot Token first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Render Linear team/project selector if provider is linear
  if (isLinear) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='w-full'>
              {subBlock.id === 'teamId' ? (
                <LinearTeamSelector
                  value={selectedProjectId}
                  onChange={(teamId: string, teamInfo?: LinearTeamInfo) => {
                    handleProjectChange(teamId, teamInfo)
                  }}
                  credential={getValue(blockId, 'credential') as string}
                  label={subBlock.placeholder || 'Select Linear team'}
                  disabled={disabled || !getValue(blockId, 'credential')}
                  showPreview={true}
                />
              ) : (
                (() => {
                  const credential = getValue(blockId, 'credential') as string
                  const teamId = getValue(blockId, 'teamId') as string
                  const isDisabled = disabled || !credential || !teamId
                  return (
                    <LinearProjectSelector
                      value={selectedProjectId}
                      onChange={(projectId: string, projectInfo?: LinearProjectInfo) => {
                        handleProjectChange(projectId, projectInfo)
                      }}
                      credential={credential}
                      teamId={teamId}
                      label={subBlock.placeholder || 'Select Linear project'}
                      disabled={isDisabled}
                    />
                  )
                })()
              )}
            </div>
          </TooltipTrigger>
          {!getValue(blockId, 'credential') && (
            <TooltipContent side='top'>
              <p>Please select a Linear account first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Default to Jira project selector
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='w-full'>
            <JiraProjectSelector
              value={selectedProjectId}
              onChange={handleProjectChange}
              domain={domain}
              provider='jira'
              requiredScopes={subBlock.requiredScopes || []}
              serviceId={subBlock.serviceId}
              label={subBlock.placeholder || 'Select Jira project'}
              disabled={disabled}
              showPreview={true}
              onProjectInfoChange={setProjectInfo}
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
