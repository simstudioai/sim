import { listWorkspacesInputSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import { executeOrganizationWorkspaceUseCase } from '@/lib/mothership/application/execute-organization-workspace-use-case'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'
import { listOrganizationWorkspaces } from '@/lib/workspaces/application/list-organization-workspaces'

export const listWorkspacesServerTool: BaseServerTool = {
  name: 'list_workspaces',
  inputSchema: listWorkspacesInputSchema,
  async execute(raw, context) {
    try {
      const result = await executeOrganizationWorkspaceUseCase(
        context,
        listOrganizationWorkspaces,
        listWorkspacesInputSchema.parse(raw)
      )
      return { success: true, ...result }
    } catch (error) {
      return {
        success: false,
        message: messageForCopilotApplicationError(error, 'Workspace discovery failed'),
      }
    }
  },
}
