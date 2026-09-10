import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  executeCopilotOrganizationKnowledgeUseCase,
  messageForCopilotKnowledgeError,
  requireCopilotKnowledgeScope,
} from '@/lib/copilot/application/execute-knowledge-use-case'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { listPersonalSearchIntegrations } from '@/lib/knowledge/application/personal-search-integrations'

const logger = createLogger('ListSearchIntegrations')
const inputSchema = z
  .object({
    connectorType: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict()

export const listIntegrationsServerTool: BaseServerTool = {
  name: 'list_integrations',
  async execute(raw, context) {
    try {
      const scope = requireCopilotKnowledgeScope(context)
      if (scope.kind !== 'organization')
        throw new Error('Integration inventory requires organization Search')
      const input = inputSchema.parse(raw)
      const data = await executeCopilotOrganizationKnowledgeUseCase(
        context,
        listPersonalSearchIntegrations,
        {
          ...input,
          organizationId: scope.organizationId,
        }
      )
      return {
        success: true,
        data,
        message:
          'These are your current Search connections. Connected does not mean indexed. To offer a connection, emit the exact action or target inside a terminal <credential> tag, without a URL. Refresh this inventory after the user submits connection status. Follow nextCursor before claiming this list is complete.',
      }
    } catch (error) {
      logger.error('Could not list personal Search integrations', { error })
      return {
        success: false,
        message:
          error instanceof z.ZodError
            ? 'Invalid integration inventory arguments'
            : messageForCopilotKnowledgeError(error),
      }
    }
  },
}
