import type { DelegatedPrincipal } from '@sim/auth/principal'
import type {
  DeploymentsDeployBody,
  DeploymentsGetVersionQuery,
  DeploymentsListVersionsQuery,
  DeploymentsPromoteBody,
  DeploymentsUndeployBody,
} from '@/lib/internal/deployments/input'
import {
  activateWorkflowVersion,
  deployWorkflow,
  undeployWorkflow,
} from '@/lib/workflows/application/deployments'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'

export interface DeploymentApplicationClientContext {
  principal: DelegatedPrincipal
  requestId: string
  signal?: AbortSignal
}

function assertNotAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

export async function deployWorkflowDeployment(
  input: DeploymentsDeployBody,
  context: DeploymentApplicationClientContext
) {
  assertNotAborted(context.signal)
  const result = await deployWorkflow.execute({
    principal: context.principal,
    input: {
      workflowId: input.workflowId,
      assertedWorkspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? undefined,
      requestId: context.requestId,
      idempotencyKey: context.requestId,
    },
  })
  return result
}

export async function undeployWorkflowDeployment(
  input: DeploymentsUndeployBody,
  context: DeploymentApplicationClientContext
) {
  assertNotAborted(context.signal)
  const result = await undeployWorkflow.execute({
    principal: context.principal,
    input: {
      workflowId: input.workflowId,
      assertedWorkspaceId: input.workspaceId,
      requestId: context.requestId,
    },
  })
  return result
}

export async function promoteWorkflowDeployment(
  input: DeploymentsPromoteBody,
  context: DeploymentApplicationClientContext
) {
  assertNotAborted(context.signal)
  const result = await activateWorkflowVersion.execute({
    principal: context.principal,
    input: {
      workflowId: input.workflowId,
      assertedWorkspaceId: input.workspaceId,
      version: input.version,
      transition: 'activate',
      requestId: context.requestId,
      idempotencyKey: context.requestId,
    },
  })
  return result
}

export async function listWorkflowDeploymentVersions(
  input: DeploymentsListVersionsQuery,
  context: DeploymentApplicationClientContext
) {
  assertNotAborted(context.signal)
  const result = await listWorkflowVersions.execute({
    principal: context.principal,
    input: {
      workflowId: input.workflowId,
      assertedWorkspaceId: input.workspaceId,
    },
  })
  assertNotAborted(context.signal)
  return result
}

export async function getWorkflowDeploymentVersion(
  input: DeploymentsGetVersionQuery,
  context: DeploymentApplicationClientContext
) {
  assertNotAborted(context.signal)
  const result = await readWorkflowVersion.execute({
    principal: context.principal,
    input: {
      workflowId: input.workflowId,
      assertedWorkspaceId: input.workspaceId,
      version: input.version,
    },
  })
  assertNotAborted(context.signal)
  return result
}
