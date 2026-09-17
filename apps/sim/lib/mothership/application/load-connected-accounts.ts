import { workspaceAccountsSettingsDelegationPolicy } from '@/lib/credential-groups/application/authorization'
import { getWorkspaceAccountsSettings } from '@/lib/credential-groups/application/manage-groups'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type TrustedCopilotExecutionContext,
} from '@/lib/mothership/auth/application-delegation'

const executeWorkspaceAccountsUseCase = createCopilotApplicationAdapter({
  domain: 'connected accounts',
  delegation: {
    audience: workspaceAccountsSettingsDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: { workspaceSettings: credentialGroupOperations.workspaceSettings },
})

/** Reads the workspace's account configuration with the acting admin's current access. */
export async function loadCopilotConnectedAccounts(context: TrustedCopilotExecutionContext) {
  const { credentialGroup } = await executeWorkspaceAccountsUseCase(
    context,
    getWorkspaceAccountsSettings,
    { workspaceId: context.workspaceId }
  )
  return credentialGroup
}
