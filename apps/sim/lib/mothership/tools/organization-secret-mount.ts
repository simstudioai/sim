import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeOrganizationSecretUseCase } from '@/lib/mothership/application/execute-organization-secret-use-case'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import {
  type MaterializedCopilotCodeSecrets,
  materializeCopilotCodeSecrets,
} from '@/lib/mothership/tools/secret-mount-materializer.server'
import {
  listOrganizationSecretNames,
  mountOrganizationSecrets,
} from '@/lib/organization-secrets/application/use-cases'
import { MAX_SECRET_ENVIRONMENT_BYTES } from '@/lib/organization-secrets/validation'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

/** Organization chat names resolve from its active source, then the explicitly targeted workspace. */
export async function materializeOrganizationCodeSecrets(
  context: ToolExecutionContext,
  names: string[]
): Promise<MaterializedCopilotCodeSecrets> {
  if (
    (context.requestMode !== 'agent' && context.requestMode !== 'plan') ||
    context.secretActorUserId === null
  ) {
    throw new OrchestrationError('forbidden', 'Generic Secrets require Build or Plan mode')
  }
  const organizationContext = {
    ...context,
    organizationId: context.organizationId ?? context.chatOrganizationId,
    workspaceId: undefined,
    workflowId: undefined,
  }
  const organizationNames = await executeOrganizationSecretUseCase(
    organizationContext,
    listOrganizationSecretNames,
    {}
  ).then(
    (inventory) => inventory.names,
    (error: unknown) => {
      // Revoked shared secrets leave only the targeted workspace's own to resolve.
      if (error instanceof PermissionGroupCapabilityError) return []
      throw error
    }
  )
  const available = new Set(organizationNames)
  const requestedOrganizationNames = names.filter((name) => available.has(name))
  const workspaceNames = names.filter((name) => !available.has(name))
  if (workspaceNames.length && !context.workspaceId) {
    throw new OrchestrationError('forbidden', 'One or more requested secrets are unavailable')
  }
  const mounted = requestedOrganizationNames.length
    ? await executeOrganizationSecretUseCase(organizationContext, mountOrganizationSecrets, {
        names: requestedOrganizationNames,
      })
    : { envVars: {}, catalogEntries: [] }
  const workspace =
    workspaceNames.length && context.workspaceId
      ? await materializeCopilotCodeSecrets({
          actorUserId: context.userId,
          workspaceId: context.workspaceId,
          requestedNames: workspaceNames,
        })
      : { envVars: {}, catalogEntries: [] }
  const catalogEntries = [...mounted.catalogEntries, ...workspace.catalogEntries]
  if (
    catalogEntries.reduce((total, entry) => total + Buffer.byteLength(entry.plaintext), 0) >
    MAX_SECRET_ENVIRONMENT_BYTES
  ) {
    throw new OrchestrationError('validation', 'Requested secrets exceed the code mount size limit')
  }
  return { envVars: { ...workspace.envVars, ...mounted.envVars }, catalogEntries }
}
