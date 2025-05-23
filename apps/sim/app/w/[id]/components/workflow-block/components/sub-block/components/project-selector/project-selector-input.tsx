'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
<<<<<<< HEAD
import type { SubBlockConfig } from '@/blocks/types'
import { createLogger } from '@/lib/logs/console-logger'
=======
>>>>>>> 86800d81 (fix: removed comments)
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { type DiscordServerInfo, DiscordServerSelector } from './components/discord-server-selector'
import { type JiraProjectInfo, JiraProjectSelector } from './components/jira-project-selector'
import { type LinearProjectInfo, LinearProjectSelector } from './components/linear-project-selector'
import { type LinearTeamInfo, LinearTeamSelector } from './components/linear-team-selector'


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
  previewValue
}: ProjectSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [_projectInfo, setProjectInfo] = useState<JiraProjectInfo | DiscordServerInfo | null>(null)

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
      setSelectedProjectId(previewValue);
    } else {
      const value = getValue(blockId, subBlock.id);
      if (value && typeof value === 'string') {
        setSelectedProjectId(value);
      }
    }
  }, [blockId, subBlock.id, getValue, isPreview, previewValue]);

  // Handle project selection
  const handleProjectChange = (
    projectId: string,
    info?: JiraProjectInfo | DiscordServerInfo | LinearTeamInfo | LinearProjectInfo
  ) => {
    setSelectedProjectId(projectId)
    setProjectInfo(info || null)
    setValue(blockId, subBlock.id, projectId)

    // Clear the issue-related fields when a new project is selected
    if (provider === 'jira') {
      setValue(blockId, 'summary', '')
      setValue(blockId, 'description', '')
      setValue(blockId, 'issueKey', '')
    } else if (provider === 'discord') {
      setValue(blockId, 'channelId', '')
    } else if (provider === 'linear') {
      if (subBlock.id === 'teamId') {
        setValue(blockId, 'teamId', projectId)
        setValue(blockId, 'projectId', '')
      } else if (subBlock.id === 'projectId') {
        setValue(blockId, 'projectId', projectId)
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
