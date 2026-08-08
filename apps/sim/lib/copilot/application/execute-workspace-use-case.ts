import {
  type CopilotWorkspaceDelegationContext,
  createCopilotWorkspacePrincipal,
} from '@/lib/copilot/auth/workspace-application-delegation'
import type { OperationUseCase, WorkspaceOperation } from '@/lib/core/application'

interface CopilotWorkspaceUseCaseExecutorOptions<O extends WorkspaceOperation> {
  audience: string
  operations: Readonly<Record<string, O>>
}

/** Binds a domain registry to the trusted Copilot workspace execution runtime. */
export function createCopilotWorkspaceUseCaseExecutor<O extends WorkspaceOperation>(
  options: CopilotWorkspaceUseCaseExecutorOptions<O>
) {
  const registeredOperationIds = new Set(
    Object.values(options.operations).map((operation) => operation.id)
  )

  return function executeCopilotWorkspaceUseCase<Selected extends O, I, R>(
    context: CopilotWorkspaceDelegationContext | undefined,
    useCase: OperationUseCase<Selected, I, R>,
    input: I
  ): Promise<R> {
    if (!registeredOperationIds.has(useCase.operation.id)) {
      throw new Error(`Unregistered Copilot workspace operation: ${useCase.operation.id}`)
    }

    return useCase.execute({
      principal: createCopilotWorkspacePrincipal(context, { audience: options.audience }),
      input,
    })
  }
}
