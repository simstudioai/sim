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
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [_projectInfo, setProjectInfo] = useState<JiraProjectInfo | DiscordServerInfo | null>(null)
  // Use the proper hook to get the current value and setter
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [connectedCredential] = useSubBlockValue(blockId, 'credential')
  const { isForeignCredential } = useForeignCredential(
    subBlock.provider || subBlock.serviceId || 'jira',
    (connectedCredential as string) || ''
  )
  // Reactive dependencies from store for Linear
  const [linearCredential] = useSubBlockValue(blockId, 'credential')
  const [linearTeamId] = useSubBlockValue(blockId, 'teamId')
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId) as string | null
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, { disabled, isPreview })

  // Get provider-specific values
  const provider = subBlock.provider || 'jira'
  const isDiscord = provider === 'discord'
  const isLinear = provider === 'linear'

  // Jira/Discord upstream fields
  const [jiraDomain] = useSubBlockValue(blockId, 'domain')
  const [jiraCredential] = useSubBlockValue(blockId, 'credential')
  const domain = (jiraDomain as string) || ''
  const botToken = ''

  // Verify Jira credential belongs to current user; if not, treat as absent

  // Get the current value from the store or prop value if in preview mode
  useEffect(() => {
    if (isPreview && previewValue !== undefined) {
      setSelectedProjectId(previewValue)
    } else if (typeof storeValue === 'string') {
      setSelectedProjectId(storeValue)
    } else {
      setSelectedProjectId('')
    }
  }, [isPreview, previewValue, storeValue])

  // Handle project selection
  const handleProjectChange = (
    projectId: string,
    info?: JiraProjectInfo | DiscordServerInfo | LinearTeamInfo | LinearProjectInfo
  ) => {
    setSelectedProjectId(projectId)
    setProjectInfo(info || null)
    setStoreValue(projectId)

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
                  credential={(linearCredential as string) || ''}
                  label={subBlock.placeholder || 'Select Linear team'}
                  disabled={finalDisabled}
                  showPreview={true}
                  workflowId={activeWorkflowId || ''}
                />
              ) : (
                (() => {
                  const credential = (linearCredential as string) || ''
                  const teamId = (linearTeamId as string) || ''
                  const isDisabled = finalDisabled
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
                      workflowId={activeWorkflowId || ''}
                    />
                  )
                })()
              )}
            </div>
          </TooltipTrigger>
          {!(linearCredential as string) && (
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
              disabled={finalDisabled}
              showPreview={true}
              onProjectInfoChange={setProjectInfo}
              credentialId={(jiraCredential as string) || ''}
              isForeignCredential={isForeignCredential}
              workflowId={activeWorkflowId || ''}
            />
          </div>
        </TooltipTrigger>
      </Tooltip>
    </TooltipProvider>
  )
}
