import {
  type ListUserProjectsInput,
  listUserProjectsInputSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/errors'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import { executeCopilotProjectDiscovery } from '@/lib/mothership/application/execute-project-use-case'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'
import { listProjects } from '@/lib/projects/application'
import { getProjectFileCapabilities } from '@/lib/projects/files/application'

/** Each capability is a separately authorized read; bounded so a full page cannot claim many pooled connections at once. */
const PROJECT_CAPABILITY_CONCURRENCY = 4

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
      const capabilities = await mapWithConcurrency(
        result.projects,
        PROJECT_CAPABILITY_CONCURRENCY,
        async (project) => {
          const target = { projectId: project.id }
          try {
            return await executeCopilotProjectFileUseCase(
              context,
              getProjectFileCapabilities,
              target,
              target
            )
          } catch (error) {
            const code = asOrchestrationError(error)?.code
            if (code !== 'forbidden' && code !== 'not_found' && code !== 'conflict') throw error
            return null
          }
        }
      )
      const fileOwnerCapabilities = capabilities.filter((capability) => capability !== null)
      return { success: true, ...result, fileOwnerCapabilities }
    } catch (error) {
      return {
        success: false,
        message: messageForCopilotApplicationError(error, 'Project discovery failed'),
      }
    }
  },
}
