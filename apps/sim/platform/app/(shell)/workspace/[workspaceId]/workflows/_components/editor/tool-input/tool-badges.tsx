'use client'

import type { MouseEvent } from 'react'
import { Tooltip } from '@sim/emcn/tooltip'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-input.module.css'
import { useUserPermissionsContext } from '@/platform/lib/data/workflow-editor'
import {
  getIssueBadgeLabel,
  getIssueBadgeVariant,
  type McpToolIssue,
  useDeploymentInfo,
  useDeployWorkflow,
} from '@/platform/lib/data/workflow-editor/tool-input'

function stopCardToggle(event: MouseEvent) {
  event.stopPropagation()
}

interface McpIssueBadgeProps {
  issue: McpToolIssue
  /** Opens the server's MCP settings. */
  onOpenSettings: () => void
}

/** What is wrong with a selected MCP tool, opening its server's settings. */
export function McpIssueBadge({ issue, onOpenSettings }: McpIssueBadgeProps) {
  return (
    <Tooltip label={`${issue.message}: click to open settings`}>
      <button
        type='button'
        className={styles.badge}
        data-intent={getIssueBadgeVariant(issue) === 'red' ? 'danger' : 'warning'}
        data-type='T052'
        onMouseDown={stopCardToggle}
        onClick={(event) => {
          event.stopPropagation()
          onOpenSettings()
        }}
      >
        {getIssueBadgeLabel(issue)}
      </button>
    </Tooltip>
  )
}

interface WorkflowDeployBadgeProps {
  workflowId: string
}

/**
 * Marks a workflow tool whose workflow is undeployed or has changes since its last deploy, and
 * deploys it on click for an admin.
 */
export function WorkflowDeployBadge({ workflowId }: WorkflowDeployBadgeProps) {
  const { data, isLoading } = useDeploymentInfo(workflowId)
  const { mutate, isPending: isDeploying } = useDeployWorkflow()
  const { canAdmin } = useUserPermissionsContext()

  const isDeployed = data?.isDeployed ?? null
  const needsRedeploy = data?.needsRedeployment ?? false

  if (isLoading || (isDeployed && !needsRedeploy) || typeof isDeployed !== 'boolean') return null

  const label = isDeploying ? 'Deploying…' : isDeployed ? 'Redeploy' : 'Undeployed'
  const tooltip = !canAdmin
    ? 'Admin permission required to deploy'
    : isDeployed
      ? 'Click to redeploy'
      : 'Click to deploy'

  return (
    <Tooltip label={tooltip} disabledControl={!canAdmin}>
      <button
        type='button'
        className={styles.badge}
        data-intent={isDeployed ? 'warning' : 'danger'}
        data-type='T052'
        disabled={!canAdmin}
        onMouseDown={stopCardToggle}
        onClick={(event) => {
          event.stopPropagation()
          if (isDeploying || !canAdmin) return
          mutate({ workflowId })
        }}
      >
        {label}
      </button>
    </Tooltip>
  )
}
