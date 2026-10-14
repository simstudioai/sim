import type {
  DelegatedPrincipal,
  Principal,
  ResourceDelegatedPrincipal,
  ResourceDelegationScope,
} from '@sim/auth/principal'
import {
  type ApplicationOperation,
  type OperationUseCase,
  requireAllowedWorkspacePrincipal,
  type WorkspaceOperation,
} from '@/lib/core/application'
import {
  type CopilotDelegationConfiguration,
  type CopilotExecutionContext,
  type CopilotResourceDelegationConfiguration,
  type CopilotResourceScope,
  createCopilotApplicationPrincipal,
  createCopilotResourceApplicationPrincipal,
  requireTrustedCopilotExecutionContext,
  requireTrustedCopilotResourceExecutionContext,
  type TrustedCopilotExecutionContext,
  type TrustedCopilotResourceExecutionContext,
} from '@/lib/mothership/auth/application-delegation'

type CopilotApplicationPrincipalFactory = (args: {
  context: TrustedCopilotExecutionContext
  resourceScope: CopilotResourceScope
}) => DelegatedPrincipal

interface CopilotApplicationAdapterOptions<O extends WorkspaceOperation, ScopeInput = undefined> {
  mode?: 'workspace'
  domain: string
  delegation: CopilotDelegationConfiguration
  operations: Readonly<Record<string, O>>
  projectResourceScope?(
    input: ScopeInput,
    context: TrustedCopilotExecutionContext
  ): CopilotResourceScope
  createPrincipal?: CopilotApplicationPrincipalFactory
}

interface CopilotResourceOperation extends ApplicationOperation {
  readonly principalKinds: readonly Principal['kind'][]
  readonly delegatedServices?: readonly ResourceDelegatedPrincipal['serviceId'][]
  readonly delegationAudience?: string
}

type CopilotResourceAdapterOptions<O extends CopilotResourceOperation, ScopeInput = undefined> = {
  mode: 'resource'
  domain: string
  delegation: CopilotResourceDelegationConfiguration
  operations: Readonly<Record<string, O>>
} & (
  | {
      resourceScope: ResourceDelegationScope
      projectResourceScope?: never
    }
  | {
      resourceScope?: never
      projectResourceScope(
        input: ScopeInput,
        context: TrustedCopilotResourceExecutionContext
      ): ResourceDelegationScope
    }
)

type ScopeArguments<ScopeInput> = [ScopeInput] extends [undefined] ? [] : [scope: ScopeInput]

type CopilotApplicationExecutor<O extends ApplicationOperation, ScopeInput> = <
  Selected extends O,
  I,
  R,
>(
  context: CopilotExecutionContext | undefined,
  useCase: OperationUseCase<Selected, I, R>,
  input: I,
  ...scopeArguments: ScopeArguments<ScopeInput>
) => Promise<R>

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

function registeredCopilotOperations<O extends ApplicationOperation>(options: {
  domain: string
  delegation: { audience: string; ttlMs: number }
  operations: Readonly<Record<string, O>>
}): Set<O> {
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
  return new Set<O>(operations)
}

function createWorkspaceApplicationAdapter<O extends WorkspaceOperation, ScopeInput>(
  options: CopilotApplicationAdapterOptions<O, ScopeInput>
): CopilotApplicationExecutor<O, ScopeInput> {
  const registeredOperations = registeredCopilotOperations(options)

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

function createResourceApplicationAdapter<O extends CopilotResourceOperation, ScopeInput>(
  options: CopilotResourceAdapterOptions<O, ScopeInput>
): CopilotApplicationExecutor<O, ScopeInput> {
  const registeredOperations = registeredCopilotOperations(options)
  return function executeCopilotResourceUseCase<Selected extends O, I, R>(
    context: CopilotExecutionContext | undefined,
    useCase: OperationUseCase<Selected, I, R>,
    input: I,
    ...scopeArguments: ScopeArguments<ScopeInput>
  ): Promise<R> {
    if (!registeredOperations.has(useCase.operation)) {
      throw new Error(`Unregistered Copilot ${options.domain} operation: ${useCase.operation.id}`)
    }
    const operation = useCase.operation
    if (
      !operation.principalKinds.includes('resource_delegated') ||
      !operation.delegatedServices?.includes('copilot')
    ) {
      throw new Error(`Operation ${operation.id} does not admit Copilot resource delegation`)
    }
    if (operation.delegationAudience !== options.delegation.audience) {
      throw new Error(`Operation ${operation.id} has a different delegation audience`)
    }
    const trustedContext = requireTrustedCopilotResourceExecutionContext(context)
    let scope: ResourceDelegationScope
    if (options.projectResourceScope) {
      if (scopeArguments.length !== 1) {
        throw new Error(`Copilot ${options.domain} execution requires trusted scope input`)
      }
      scope = options.projectResourceScope(scopeArguments[0], trustedContext)
    } else {
      if (scopeArguments.length !== 0) {
        throw new Error(`Copilot ${options.domain} execution does not accept resource scope input`)
      }
      scope = options.resourceScope
    }
    const principal = createCopilotResourceApplicationPrincipal(trustedContext, {
      ...options.delegation,
      scope,
    })
    return useCase.execute({ principal, input })
  }
}

/** Adapts admitted Copilot calls to registered operations without changing their owner policy. */
export function createCopilotApplicationAdapter<
  O extends CopilotResourceOperation,
  ScopeInput = undefined,
>(options: CopilotResourceAdapterOptions<O, ScopeInput>): CopilotApplicationExecutor<O, ScopeInput>
export function createCopilotApplicationAdapter<
  O extends WorkspaceOperation,
  ScopeInput = undefined,
>(
  options: CopilotApplicationAdapterOptions<O, ScopeInput>
): CopilotApplicationExecutor<O, ScopeInput>
export function createCopilotApplicationAdapter<ScopeInput = undefined>(
  options:
    | CopilotApplicationAdapterOptions<WorkspaceOperation, ScopeInput>
    | CopilotResourceAdapterOptions<CopilotResourceOperation, ScopeInput>
) {
  return options.mode === 'resource'
    ? createResourceApplicationAdapter(options)
    : createWorkspaceApplicationAdapter(options)
}
