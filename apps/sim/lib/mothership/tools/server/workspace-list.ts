import { listWorkspacesInputSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'
import { listOrganizationWorkspaces } from '@/lib/workspaces/application/list-organization-workspaces'

export const listWorkspacesServerTool: BaseServerTool = {
  name: 'list_workspaces',
  inputSchema: listWorkspacesInputSchema,
  async execute(raw, context) {
    try {
      const trusted = requireTrustedOrganizationCopilotContext(context)
      if (context?.requestMode !== 'agent')
        throw new Error('Workspace discovery requires organization agent mode')
      const principal = createTrustedOrganizationCopilotPrincipal(
        { ...trusted, delegationId: trusted.toolCallId },
        { audience: 'sim:workspaces', ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
      )
      await authorizeOrganizationChatDelegation.execute({ principal })
      const result = await listOrganizationWorkspaces.execute({
        principal,
        input: { ...listWorkspacesInputSchema.parse(raw), organizationId: trusted.organizationId },
      })
      return { success: true, ...result }
    } catch (error) {
      return {
        success: false,
        message: messageForCopilotApplicationError(error, 'Workspace discovery failed'),
      }
    }
  },
}
