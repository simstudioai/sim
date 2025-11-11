'use client'

import { useEffect, useState } from 'react'
import { Tooltip } from '@/components/emcn'
import {
  type JiraProjectInfo,
  JiraProjectSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/project-selector/components/jira-project-selector'
import {
  type LinearProjectInfo,
  LinearProjectSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/project-selector/components/linear-project-selector'
import {
  type LinearTeamInfo,
  LinearTeamSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/project-selector/components/linear-team-selector'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
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
  previewContextValues?: Record<string, any>
}

export function ProjectSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onProjectSelect,
  isPreview = false,
  previewValue,
  previewContextValues,
}: ProjectSelectorInputProps) {
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [_projectInfo, setProjectInfo] = useState<any | null>(null)
  // Use the proper hook to get the current value and setter
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [connectedCredentialFromStore] = useSubBlockValue(blockId, 'credential')
  const [linearTeamIdFromStore] = useSubBlockValue(blockId, 'teamId')
  const [jiraDomainFromStore] = useSubBlockValue(blockId, 'domain')

  // Use previewContextValues if provided (for tools inside agent blocks), otherwise use store values
  const connectedCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const linearCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const linearTeamId = previewContextValues?.teamId ?? linearTeamIdFromStore
  const jiraDomain = previewContextValues?.domain ?? jiraDomainFromStore

  const { isForeignCredential } = useForeignCredential(
    subBlock.provider || subBlock.serviceId || 'jira',
    (connectedCredential as string) || ''
  )
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId) as string | null
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  // Get provider-specific values
  const provider = subBlock.provider || 'jira'
  const isLinear = provider === 'linear'

  // Jira/Discord upstream fields - use values from previewContextValues or store
  const jiraCredential = connectedCredential
  const domain = (jiraDomain as string) || ''

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
    info?: JiraProjectInfo | LinearTeamInfo | LinearProjectInfo
  ) => {
    setSelectedProjectId(projectId)
    setProjectInfo(info || null)
    setStoreValue(projectId)

    onProjectSelect?.(projectId)
  }

  // Discord no longer uses a server selector; fall through to other providers

  // Render Linear team/project selector if provider is linear
  if (isLinear) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
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
        </Tooltip.Trigger>
        {!(linearCredential as string) && (
          <Tooltip.Content side='top'>
            <p>Please select a Linear account first</p>
          </Tooltip.Content>
        )}
      </Tooltip.Root>
    )
  }

  // Default to Jira project selector
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
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
      </Tooltip.Trigger>
    </Tooltip.Root>
  )
}
