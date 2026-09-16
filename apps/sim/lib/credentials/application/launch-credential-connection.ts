import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { type ConnectDraft, getActiveConnectDraft } from '@/lib/credentials/connect-draft'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

export interface LaunchCredentialConnectionInput {
  draftId: string
}

interface LaunchCredentialConnectionContext extends ActiveWorkspaceApplicationContext {
  draft: ConnectDraft
}

export interface LaunchCredentialConnectionResult {
  draft: ConnectDraft
}

export const launchCredentialConnection = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.launchConnection,
  resolveContext: async ({
    principal,
    input,
  }: {
    principal: { kind: 'session'; userId: string; sessionId: string }
    input: LaunchCredentialConnectionInput
  }): Promise<LaunchCredentialConnectionContext> => {
    const draft = await getActiveConnectDraft(input.draftId, principal.userId)
    if (!draft?.workspaceId)
      throw new OrchestrationError('not_found', 'OAuth connection link is invalid or expired')
    const workspace = await loadActiveWorkspaceApplicationContext(draft.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    return { ...workspace, draft }
  },
  authorizationOptions: {},
  execute: async ({ principal, context }): Promise<LaunchCredentialConnectionResult> => {
    const target = await resolveCredentialConnectionTarget({
      principal,
      context,
      providerId: context.draft.credentialId ? undefined : context.draft.providerId,
      credentialId: context.draft.credentialId ?? undefined,
    })
    if (target.providerId !== context.draft.providerId) {
      throw new OrchestrationError('conflict', 'OAuth connection provider no longer matches')
    }
    return { draft: context.draft }
  },
})
