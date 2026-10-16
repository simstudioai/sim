import { markCopilotResourceRequest } from '@/lib/api/server/routes/copilot-request'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import {
  admitsCopilotResourceDelegation,
  createCopilotApplicationAdapter,
} from '@/lib/mothership/application/adapter'
import {
  type CopilotExecutionContext,
  type CopilotResourceDelegationConfiguration,
  createCopilotResourceApplicationPrincipal,
  requireTrustedCopilotResourceExecutionContext,
} from '@/lib/mothership/auth/application-delegation'
import { projectFileOperations } from '@/lib/projects/files/application'
import type { ProjectFileTarget } from '@/lib/projects/files/application/authorization'
import {
  PROJECT_FILE_DELEGATION_TTL_MS,
  type ProjectFileOperation,
  projectFileDelegationScope,
} from '@/lib/projects/files/application/operations'

const PROJECT_FILE_DELEGATION: CopilotResourceDelegationConfiguration = {
  audience: projectFileOperations.list.delegationAudience,
  ttlMs: PROJECT_FILE_DELEGATION_TTL_MS,
  createDelegationId: (context) => context.toolCallId,
}

const REGISTERED_OPERATIONS = new Map<ApplicationOperation, ProjectFileOperation>(
  Object.values(projectFileOperations).map((operation) => [operation, operation])
)

export const executeCopilotProjectFileUseCase = createCopilotApplicationAdapter({
  mode: 'resource',
  domain: 'project files',
  operations: projectFileOperations,
  projectResourceScope: projectFileDelegationScope,
  delegation: PROJECT_FILE_DELEGATION,
})

/** Binds one precise Project request to opaque authoring admission; the use case reauthorizes current access. */
export function markCopilotProjectFileRequest(
  request: Request,
  context: CopilotExecutionContext,
  target: ProjectFileTarget
): void {
  const trustedContext = requireTrustedCopilotResourceExecutionContext(context)
  if (!target.projectId.trim() || (target.fileId !== undefined && !target.fileId.trim())) {
    throw new Error('Copilot Project file requests require a valid resource target')
  }
  const bound = Object.freeze({ ...target })
  markCopilotResourceRequest(request, (operation, audience) => {
    const registered = REGISTERED_OPERATIONS.get(operation)
    if (
      !registered ||
      !admitsCopilotResourceDelegation(registered) ||
      registered.delegationAudience !== audience ||
      (registered.target === 'file') !== (bound.fileId !== undefined)
    ) {
      return undefined
    }
    return createCopilotResourceApplicationPrincipal(trustedContext, {
      ...PROJECT_FILE_DELEGATION,
      scope: projectFileDelegationScope(bound),
    })
  })
}
