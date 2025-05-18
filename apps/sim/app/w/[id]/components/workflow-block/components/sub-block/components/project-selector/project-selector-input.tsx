'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { SubBlockConfig } from '@/blocks/types'
import { DiscordServerInfo, DiscordServerSelector } from './components/discord-server-selector'
import { JiraProjectInfo, JiraProjectSelector } from './components/jira-project-selector'

const logger = createLogger('ProjectSelectorInput')

interface ProjectSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onProjectSelect?: (projectId: string) => void
  isPreview?: boolean
  value?: string
}

export function ProjectSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onProjectSelect,
  isPreview = false,
  value: propValue
}: ProjectSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [projectInfo, setProjectInfo] = useState<JiraProjectInfo | DiscordServerInfo | null>(null)

  // Log when in preview mode to verify it's working
  useEffect(() => {
    if (isPreview) {
      logger.info(`[PREVIEW] ProjectSelectorInput for ${blockId}:${subBlock.id}`, {
        isPreview,
        propValue
      });
    }
  }, [isPreview, propValue, blockId, subBlock.id]);

  // Get provider-specific values
  const provider = subBlock.provider || 'jira'
  const isDiscord = provider === 'discord'

  // For Jira, we need the domain
  const domain = !isDiscord ? (getValue(blockId, 'domain') as string) || '' : ''
  const botToken = isDiscord ? (getValue(blockId, 'botToken') as string) || '' : ''

  // Get the current value from the store or prop value if in preview mode
  useEffect(() => {
    if (isPreview && propValue !== undefined) {
      setSelectedProjectId(propValue);
    } else {
      const value = getValue(blockId, subBlock.id);
      if (value && typeof value === 'string') {
        setSelectedProjectId(value);
      }
    }
  }, [blockId, subBlock.id, getValue, isPreview, propValue]);

  // Handle project selection
  const handleProjectChange = (projectId: string, info?: JiraProjectInfo | DiscordServerInfo) => {
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
    }

    onProjectSelect?.(projectId)
  }

  // Render Discord server selector if provider is discord
  if (isDiscord) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full">
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
            <TooltipContent side="top">
              <p>Please enter a Bot Token first</p>
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
          <div className="w-full">
            <JiraProjectSelector
              value={selectedProjectId}
              onChange={handleProjectChange}
              domain={domain}
              provider="jira"
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
          <TooltipContent side="top">
            <p>Please enter a Jira domain first</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}
