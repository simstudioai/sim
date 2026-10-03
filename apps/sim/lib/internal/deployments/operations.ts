import {
  type DeploymentApplicationClientContext,
  deployWorkflowDeployment,
  getWorkflowDeploymentVersion,
  listWorkflowDeploymentVersions,
  promoteWorkflowDeployment,
  undeployWorkflowDeployment,
} from '@/lib/internal/deployments/client'
import type {
  DeploymentsDeployBody,
  DeploymentsGetVersionQuery,
  DeploymentsListVersionsQuery,
  DeploymentsPromoteBody,
  DeploymentsUndeployBody,
} from '@/lib/internal/deployments/input'

function serializeDeploymentTimestamp(value?: Date): string | null {
  return value?.toISOString() ?? null
}

export async function executeDeploymentsDeploy(
  input: DeploymentsDeployBody,
  context: DeploymentApplicationClientContext
) {
  const result = await deployWorkflowDeployment(input, context)
  return {
    success: true,
    output: {
      workflowId: input.workflowId,
      isDeployed: Boolean(result.activeDeployment),
      deployedAt: serializeDeploymentTimestamp(result.deployedAt),
      version: result.version,
      activeDeployment: result.activeDeployment,
      latestDeploymentAttempt: result.latestDeploymentAttempt,
      warnings: result.warnings ?? [],
    },
  }
}

export async function executeDeploymentsUndeploy(
  input: DeploymentsUndeployBody,
  context: DeploymentApplicationClientContext
) {
  const result = await undeployWorkflowDeployment(input, context)
  return {
    success: true,
    output: {
      workflowId: input.workflowId,
      isDeployed: false,
      deployedAt: null,
      warnings: result.warnings ?? [],
    },
  }
}

export async function executeDeploymentsPromote(
  input: DeploymentsPromoteBody,
  context: DeploymentApplicationClientContext
) {
  const result = await promoteWorkflowDeployment(input, context)
  return {
    success: true,
    output: {
      workflowId: input.workflowId,
      isDeployed: Boolean(result.activeDeployment),
      deployedAt: serializeDeploymentTimestamp(result.deployedAt),
      version: input.version,
      activeDeployment: result.activeDeployment,
      latestDeploymentAttempt: result.latestDeploymentAttempt,
      warnings: result.warnings ?? [],
    },
  }
}

export async function executeDeploymentsListVersions(
  input: DeploymentsListVersionsQuery,
  context: DeploymentApplicationClientContext
) {
  const { versions } = await listWorkflowDeploymentVersions(input, context)
  return {
    success: true,
    output: { workflowId: input.workflowId, versions },
  }
}

export async function executeDeploymentsGetVersion(
  input: DeploymentsGetVersionQuery,
  context: DeploymentApplicationClientContext
) {
  const { version } = await getWorkflowDeploymentVersion(input, context)
  return {
    success: true,
    output: {
      workflowId: input.workflowId,
      version: version.version,
      name: version.name,
      description: version.description,
      isActive: version.isActive,
      createdAt: version.createdAt,
      deployedState: version.state,
    },
  }
}
