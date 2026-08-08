import type { DelegatedPrincipal } from '@sim/auth/principal'

const COPILOT_WORKSPACE_DELEGATION_TTL_MS = 5 * 60 * 1000

export interface CopilotWorkspaceDelegationContext {
  userId: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  toolCallId?: string
  copilotToolExecution?: boolean
}

interface CreateCopilotWorkspacePrincipalOptions {
  audience: string
}

/** Creates a delegated principal exclusively from server-authored Copilot execution context. */
export function createCopilotWorkspacePrincipal(
  context: CopilotWorkspaceDelegationContext | undefined,
  options: CreateCopilotWorkspacePrincipalOptions
): DelegatedPrincipal {
  if (!context) throw new Error('Workspace delegation requires a Copilot execution context')
  if (!context.copilotToolExecution) {
    throw new Error('Workspace delegation requires a trusted Copilot execution context')
  }
  if (!context.toolCallId) throw new Error('Workspace delegation requires a tool call ID')
  if (!context.workspaceId) throw new Error('Workspace delegation requires a workspace ID')
  if (!options.audience) throw new Error('Workspace delegation requires an audience')

  const issuedAt = new Date()
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId: context.workspaceId,
    delegationId: `copilot-tool:${context.toolCallId}`,
    audience: options.audience,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + COPILOT_WORKSPACE_DELEGATION_TTL_MS),
    resourceScope: {
      ...(context.chatId ? { chatId: context.chatId } : {}),
      ...(context.executionId ? { executionId: context.executionId } : {}),
    },
  }
}
