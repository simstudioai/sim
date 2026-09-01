import { executeCopilotCustomToolUseCase } from '@/lib/copilot/application/execute-custom-tool-use-case'
import {
  type CopilotExecutionContext,
  requireTrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import {
  type ReadAvailableCustomToolByIdOrTitleInput,
  readAvailableCustomToolByIdOrTitleUseCase,
} from '@/lib/custom-tools/application/use-cases'
import {
  createExecutorPrincipalFromExecutionContext,
  requireExecutorWorkspaceId,
} from '@/lib/internal/principals/executor'
import type { ExecutionContext } from '@/executor/types'

export interface ReadAvailableCustomToolByIdOrTitleAsExecutorInput {
  context: ExecutionContext
  identifier: string
  lookup: ReadAvailableCustomToolByIdOrTitleInput['lookup']
}

export async function readAvailableCustomToolByIdOrTitleAsExecutor({
  context,
  identifier,
  lookup,
}: ReadAvailableCustomToolByIdOrTitleAsExecutorInput) {
  context.abortSignal?.throwIfAborted()
  const principal = await createExecutorPrincipalFromExecutionContext({
    context,
  })
  context.abortSignal?.throwIfAborted()
  const { tool } = await readAvailableCustomToolByIdOrTitleUseCase.execute({
    principal,
    input: {
      workspaceId: requireExecutorWorkspaceId(context),
      identifier,
      lookup,
    },
  })
  context.abortSignal?.throwIfAborted()
  return tool
}

export interface ReadAvailableCustomToolByIdOrTitleAsCopilotInput {
  context: CopilotExecutionContext | undefined
  identifier: string
  lookup: ReadAvailableCustomToolByIdOrTitleInput['lookup']
  signal?: AbortSignal
}

/** Resolves a dynamic custom tool through the shared Copilot application boundary. */
export async function readAvailableCustomToolByIdOrTitleAsCopilot({
  context,
  identifier,
  lookup,
  signal,
}: ReadAvailableCustomToolByIdOrTitleAsCopilotInput) {
  signal?.throwIfAborted()
  const trustedContext = requireTrustedCopilotExecutionContext(context)
  const { tool } = await executeCopilotCustomToolUseCase(
    trustedContext,
    readAvailableCustomToolByIdOrTitleUseCase,
    {
      workspaceId: trustedContext.workspaceId,
      identifier,
      lookup,
    }
  )
  signal?.throwIfAborted()
  return tool
}
