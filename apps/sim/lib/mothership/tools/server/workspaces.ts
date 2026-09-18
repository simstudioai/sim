import { mothershipWorkspacesInputSchema } from '@/lib/api/contracts/mothership-management-tools'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import { executeOrganizationWorkspaceUseCase } from '@/lib/mothership/application/execute-organization-workspace-use-case'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'
import { createOrganizationWorkspace } from '@/lib/workspaces/application/create-organization-workspace'

export const workspacesServerTool: BaseServerTool = {
  name: 'workspaces',
  inputSchema: mothershipWorkspacesInputSchema,
  async execute(raw, context) {
    try {
      const { action: _action, ...input } = mothershipWorkspacesInputSchema.parse(raw)
      const workspace = await executeOrganizationWorkspaceUseCase(
        context,
        createOrganizationWorkspace,
        input
      )
      const resources: ResourceChange[] = [
        {
          op: 'refresh',
          resource: {
            type: 'settings',
            scope: 'organization',
            id: 'workspaces',
            organizationId: workspace.organizationId,
          },
        },
      ]
      return { success: true, workspace, resources }
    } catch (error) {
      return {
        success: false,
        message: messageForCopilotApplicationError(error, 'Workspace creation failed'),
      }
    }
  },
}
