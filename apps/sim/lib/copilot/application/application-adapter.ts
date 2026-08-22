import type { DelegatedPrincipal } from '@sim/auth/principal'
import {
  type CopilotDelegationConfiguration,
  type CopilotExecutionContext,
  type CopilotResourceScope,
  createCopilotApplicationPrincipal,
  requireTrustedCopilotExecutionContext,
  type TrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import {
  type OperationUseCase,
  requireAllowedWorkspacePrincipal,
  type WorkspaceOperation,
} from '@/lib/core/application'

type CopilotApplicationPrincipalFactory = (args: {
  context: TrustedCopilotExecutionContext
  resourceScope: CopilotResourceScope
}) => DelegatedPrincipal

interface CopilotApplicationAdapterOptions<O extends WorkspaceOperation, ScopeInput = undefined> {
  domain: string
  delegation: CopilotDelegationConfiguration
  operations: Readonly<Record<string, O>>
  projectResourceScope?(
    input: ScopeInput,
    context: TrustedCopilotExecutionContext
  ): CopilotResourceScope
  createPrincipal?: CopilotApplicationPrincipalFactory
}

type ScopeArguments<ScopeInput> = [ScopeInput] extends [undefined] ? [] : [scope: ScopeInput]

const RESOURCE_SCOPE_KEYS = ['fileId', 'tableId', 'chatId', 'executionId'] as const

function requireValidProjectedResourceScope(resourceScope: CopilotResourceScope): void {
  if (resourceScope.fileId !== undefined && !resourceScope.fileId.trim()) {
    throw new Error('Copilot application resource scope contains an invalid file ID')
  }
  if (resourceScope.tableId !== undefined && !resourceScope.tableId.trim()) {
    throw new Error('Copilot application resource scope contains an invalid table ID')
  }
}

function expectedResourceScope(
  context: TrustedCopilotExecutionContext,
  resourceScope: CopilotResourceScope
): NonNullable<DelegatedPrincipal['resourceScope']> {
  return {
    ...resourceScope,
    ...(context.chatId ? { chatId: context.chatId } : {}),
    ...(context.executionId ? { executionId: context.executionId } : {}),
  }
}

function requireMatchingPrincipal(
  principal: DelegatedPrincipal,
  context: TrustedCopilotExecutionContext,
  delegation: CopilotDelegationConfiguration,
  resourceScope: CopilotResourceScope
): void {
  const delegationId = delegation.createDelegationId(context)
  if (
    principal.kind !== 'delegated' ||
    principal.serviceId !== 'copilot' ||
    principal.subjectUserId !== context.userId ||
    principal.workspaceId !== context.workspaceId ||
    !delegationId.trim() ||
    principal.delegationId !== delegationId ||
    principal.audience !== delegation.audience
  ) {
    throw new Error('Copilot principal factory violated the configured delegation identity')
  }

  const issuedAt = principal.issuedAt.getTime()
  const expiresAt = principal.expiresAt.getTime()
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > Date.now() ||
    expiresAt <= Date.now() ||
    expiresAt - issuedAt !== delegation.ttlMs
  ) {
    throw new Error('Copilot principal factory violated the configured delegation expiry')
  }

  const expectedScope = expectedResourceScope(context, resourceScope)
  if (RESOURCE_SCOPE_KEYS.some((key) => principal.resourceScope?.[key] !== expectedScope[key])) {
    throw new Error('Copilot principal factory violated the configured resource scope')
  }
}

/** Adapts trusted Copilot calls to a domain's existing application use cases. */
export function createCopilotApplicationAdapter<
  O extends WorkspaceOperation,
  ScopeInput = undefined,
>(options: CopilotApplicationAdapterOptions<O, ScopeInput>) {
  if (!options.domain.trim()) throw new Error('Copilot application adapter requires a domain')
  if (!options.delegation.audience.trim()) {
    throw new Error('Copilot application adapter requires a delegation audience')
  }
  if (!Number.isInteger(options.delegation.ttlMs) || options.delegation.ttlMs <= 0) {
    throw new Error('Copilot application adapter requires a positive integer delegation TTL')
  }

  const operations = Object.values(options.operations)
  if (operations.length === 0) {
    throw new Error(`Copilot ${options.domain} operation registry cannot be empty`)
  }
  const operationIds = new Set<string>()
  for (const operation of operations) {
    if (!Object.isFrozen(operation)) {
      throw new Error(`Copilot ${options.domain} operation ${operation.id} must be immutable`)
    }
    if (operationIds.has(operation.id)) {
      throw new Error(`Copilot ${options.domain} operation registry contains duplicate IDs`)
    }
    operationIds.add(operation.id)
  }
  const registeredOperations = new Set<O>(operations)

  return function executeCopilotApplicationUseCase<Selected extends O, I, R>(
    context: CopilotExecutionContext | undefined,
    useCase: OperationUseCase<Selected, I, R>,
    input: I,
    ...scopeArguments: ScopeArguments<ScopeInput>
  ): Promise<R> {
    if (!registeredOperations.has(useCase.operation)) {
      throw new Error(`Unregistered Copilot ${options.domain} operation: ${useCase.operation.id}`)
    }

    const trustedContext = requireTrustedCopilotExecutionContext(context)
    let resourceScope: CopilotResourceScope = {}
    if (options.projectResourceScope) {
      if (scopeArguments.length !== 1) {
        throw new Error(`Copilot ${options.domain} execution requires trusted scope input`)
      }
      resourceScope = options.projectResourceScope(scopeArguments[0], trustedContext)
    } else if (scopeArguments.length !== 0) {
      throw new Error(`Copilot ${options.domain} execution does not accept resource scope input`)
    }
    requireValidProjectedResourceScope(resourceScope)

    const principal = options.createPrincipal
      ? options.createPrincipal({ context: trustedContext, resourceScope })
      : createCopilotApplicationPrincipal(trustedContext, {
          ...options.delegation,
          resourceScope,
        })
    requireMatchingPrincipal(principal, trustedContext, options.delegation, resourceScope)
    requireAllowedWorkspacePrincipal(principal, useCase.operation)

    return useCase.execute({ principal, input })
  }
}
