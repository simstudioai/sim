import {
  type ListUserProjectsInput,
  listUserProjectsInputSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import { executeCopilotProjectDiscovery } from '@/lib/mothership/application/execute-project-use-case'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'
import { listProjects } from '@/lib/projects/application'
import { getProjectFileCapabilities } from '@/lib/projects/files/application'
import { isProjectFileApiEnabled } from '@/lib/projects/rollout.server'

export const listProjectsServerTool: BaseServerTool<ListUserProjectsInput> = {
  name: 'list_user_projects',
  inputSchema: listUserProjectsInputSchema,
  async execute(raw, context) {
    try {
      const result = await executeCopilotProjectDiscovery(
        context,
        listProjects,
        listUserProjectsInputSchema.parse(raw)
      )
      if (!(await isProjectFileApiEnabled())) return { success: true, ...result }
      const fileOwnerCapabilities = []
      for (const project of result.projects) {
        try {
          const target = { projectId: project.id }
          fileOwnerCapabilities.push(
            await executeCopilotProjectFileUseCase(
              context,
              getProjectFileCapabilities,
              target,
              target
            )
          )
        } catch (error) {
          const code = asOrchestrationError(error)?.code
          if (code !== 'forbidden' && code !== 'not_found' && code !== 'conflict') throw error
        }
      }
      return { success: true, ...result, fileOwnerCapabilities }
    } catch (error) {
      return {
        success: false,
        message: messageForCopilotApplicationError(error, 'Project discovery failed'),
      }
    }
  },
}
