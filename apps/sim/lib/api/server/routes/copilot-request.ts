import type { DelegatedPrincipal, ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { noteContentDeliveryOperation } from '@/lib/core/application'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import {
  type CopilotChatDelegationContext,
  type CopilotExecutionContext,
  createCopilotChatPrincipal,
  createCopilotResourceApplicationPrincipal,
  requireTrustedCopilotResourceExecutionContext,
  type TrustedCopilotResourceExecutionContext,
} from '@/lib/mothership/auth/application-delegation'
import type { ProjectFileTarget } from '@/lib/projects/files/application/authorization'
import {
  PROJECT_FILE_DELEGATION_TTL_MS,
  projectFileOperations,
} from '@/lib/projects/files/application/operations'
import type { CopyFileItemsInput } from '@/lib/workspace-files/application/copy-authorization'
import {
  FILE_COPY_DELEGATION_TTL_MS,
  fileCopyOperation,
} from '@/lib/workspace-files/application/copy-operation'

type CopilotRequestInvocation =
  | { kind: 'file_copy'; principal: ResourceDelegatedPrincipal }
  | { kind: 'workspace'; context: Readonly<CopilotChatDelegationContext> }
  | {
      kind: 'project_files'
      context: TrustedCopilotResourceExecutionContext
      target: Readonly<ProjectFileTarget>
    }

/** A private in-process invocation, installed only after current chat/target authorization. Never a wire header. */
const INVOCATIONS = new WeakMap<Request, CopilotRequestInvocation>()

export function markCopilotRequest(
  request: Request,
  invocation: CopilotChatDelegationContext
): void {
  INVOCATIONS.set(request, { kind: 'workspace', context: Object.freeze({ ...invocation }) })
}

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
  INVOCATIONS.set(request, {
    kind: 'project_files',
    context: trustedContext,
    target: Object.freeze({ ...target }),
  })
}

/** Carries one immutable paired grant to the registered compound operation without a wire credential. */
export function markCopilotFileCopyRequest(
  request: Request,
  context: CopilotExecutionContext,
  target: CopyFileItemsInput
): ResourceDelegatedPrincipal {
  const principal = createCopilotResourceApplicationPrincipal(
    requireTrustedCopilotResourceExecutionContext(context),
    {
      audience: fileCopyOperation.delegationAudience,
      ttlMs: FILE_COPY_DELEGATION_TTL_MS,
      createDelegationId: (trusted) => trusted.toolCallId,
      scope: { kind: 'file_copy', ...target },
    }
  )
  INVOCATIONS.set(request, { kind: 'file_copy', principal })
  return principal
}

export function isCopilotRequest(request: Request): boolean {
  return INVOCATIONS.has(request)
}

export type CopilotRouteUseCase = Pick<
  OperationUseCase<ApplicationOperation, unknown, unknown>,
  'operation' | 'delegationAudience'
>

/**
 * The audience a route admits Copilot under, or none when Mothership is refused. The
 * code-owned use case must explicitly admit Copilot and declare its domain audience. The
 * route inventory evaluates this same rule to publish which CLI commands chat can run.
 */
export function copilotRouteAudience(
  operation: ApplicationOperation,
  useCase?: CopilotRouteUseCase
): string | undefined {
  if (useCase?.operation !== operation) return undefined
  // An operation that names its delegated services without `copilot` is refused before minting.
  const services: readonly string[] | undefined =
    'delegatedServices' in operation
      ? (operation.delegatedServices as readonly string[])
      : undefined
  if (services && !services.includes('copilot')) return undefined
  return useCase.delegationAudience || undefined
}

export function copilotRequestPrincipal(
  request: Request,
  operation: ApplicationOperation,
  useCase?: CopilotRouteUseCase
): DelegatedPrincipal | ResourceDelegatedPrincipal | undefined {
  const invocation = INVOCATIONS.get(request)
  if (!invocation) return undefined
  const audience = copilotRouteAudience(operation, useCase)
  if (!audience) return undefined
  if (invocation.kind === 'file_copy') {
    if (operation !== fileCopyOperation || audience !== fileCopyOperation.delegationAudience)
      return undefined
    noteContentDeliveryOperation(operation, invocation.principal)
    return invocation.principal
  }
  if (invocation.kind === 'project_files') {
    const registered = Object.values(projectFileOperations).find((entry) => entry === operation)
    if (
      !registered ||
      !registered.principalKinds.some((kind) => kind === 'resource_delegated') ||
      !registered.delegatedServices.some((service) => service === 'copilot') ||
      registered.delegationAudience !== audience ||
      (registered.target === 'file') !== (invocation.target.fileId !== undefined)
    ) {
      return undefined
    }
    const principal = createCopilotResourceApplicationPrincipal(invocation.context, {
      audience: registered.delegationAudience,
      ttlMs: PROJECT_FILE_DELEGATION_TTL_MS,
      createDelegationId: (context) => context.toolCallId,
      scope: {
        kind: 'entity',
        entityType: 'project',
        entityId: invocation.target.projectId,
        ...(invocation.target.fileId ? { fileId: invocation.target.fileId } : {}),
      },
    })
    noteContentDeliveryOperation(operation, principal)
    return principal
  }
  const principal = createCopilotChatPrincipal(invocation.context, audience)
  markCopilotWorkspaceInvocation(principal)
  noteContentDeliveryOperation(operation, principal)
  return principal
}
