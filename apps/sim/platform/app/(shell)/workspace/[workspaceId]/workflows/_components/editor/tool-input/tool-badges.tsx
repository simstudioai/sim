'use client'

import { Button, IconButton } from '@sim/emcn/button'
import { StatusTag } from '@sim/emcn/status'
import { useUserPermissionsContext } from '@/platform/lib/data/workflow-editor'
import {
  getIssueBadgeLabel,
  getIssueBadgeVariant,
  type McpToolIssue,
  useDeploymentInfo,
  useDeployWorkflow,
} from '@/platform/lib/data/workflow-editor/tool-input'

interface McpIssueBadgeProps {
  issue: McpToolIssue
  /** Opens the server's MCP settings. */
  onOpenSettings: () => void
}

/** What is wrong with a selected MCP tool, with the action that opens its server's settings. */
export function McpIssueBadge({ issue, onOpenSettings }: McpIssueBadgeProps) {
  return (
    <>
      <StatusTag
        label={getIssueBadgeLabel(issue)}
        intent={getIssueBadgeVariant(issue) === 'red' ? 'danger' : 'warning'}
      />
      <IconButton
        label={`${issue.message}: open server settings`}
        icon='I116'
        size='compact'
        tooltip
        onClick={(event) => {
          event.stopPropagation()
          onOpenSettings()
        }}
      />
    </>
  )
}

interface WorkflowDeployBadgeProps {
  workflowId: string
}

/**
 * Marks a workflow tool whose workflow is undeployed or has changes since its last deploy, with the
 * action that deploys it for an admin.
 */
export function WorkflowDeployBadge({ workflowId }: WorkflowDeployBadgeProps) {
  const { data, isLoading } = useDeploymentInfo(workflowId)
  const { mutate, isPending: isDeploying } = useDeployWorkflow()
  const { canAdmin } = useUserPermissionsContext()

  const isDeployed = data?.isDeployed ?? null
  const needsRedeploy = data?.needsRedeployment ?? false

  if (isLoading || (isDeployed && !needsRedeploy) || typeof isDeployed !== 'boolean') return null

  return (
    <>
      <StatusTag
        label={isDeployed ? 'Changed' : 'Undeployed'}
        intent={isDeployed ? 'warning' : 'danger'}
      />
      <Button
        variant='quiet'
        size='compact'
        disabled={!canAdmin || isDeploying}
        disabledReason={canAdmin ? undefined : 'Admin permission required to deploy'}
        onClick={(event) => {
          event.stopPropagation()
          if (isDeploying || !canAdmin) return
          mutate({ workflowId })
        }}
      >
        {isDeploying ? 'Deploying…' : isDeployed ? 'Redeploy' : 'Deploy'}
      </Button>
    </>
  )
}
