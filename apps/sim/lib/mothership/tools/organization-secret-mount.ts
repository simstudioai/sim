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

/** Organization chat names resolve from its active source, then the explicitly targeted workspace. */
export async function materializeOrganizationCodeSecrets(
  context: ToolExecutionContext,
  names: string[]
): Promise<MaterializedCopilotCodeSecrets> {
  if (context.requestMode !== 'agent' || context.secretActorUserId === null) {
    throw new OrchestrationError('forbidden', 'Generic Secrets require Build mode')
  }
  const organizationContext = {
    ...context,
    organizationId: context.organizationId ?? context.chatOrganizationId,
    workspaceId: undefined,
    workflowId: undefined,
  }
  const inventory = await executeOrganizationSecretUseCase(
    organizationContext,
    listOrganizationSecretNames,
    {}
  )
  const available = new Set(inventory.names)
  const organizationNames = names.filter((name) => available.has(name))
  const workspaceNames = names.filter((name) => !available.has(name))
  if (workspaceNames.length && !context.workspaceId) {
    throw new OrchestrationError('forbidden', 'One or more requested secrets are unavailable')
  }
  const mounted = organizationNames.length
    ? await executeOrganizationSecretUseCase(organizationContext, mountOrganizationSecrets, {
        names: organizationNames,
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
