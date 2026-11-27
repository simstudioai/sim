import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { searchPeopleInputSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { getValidationErrorMessage } from '@/lib/api/server/validation'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/errors'
import { executeCopilotPeopleRead } from '@/lib/mothership/application/execute-people-use-case'
import type { BaseServerTool, ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { findDirectoryPeople, readDirectoryPerson } from '@/lib/people/directory-lookup'

const logger = createLogger('SearchPeopleTool')

/**
 * `search_people` for the organization Assistant: the same directory lookup, use cases and
 * result shape as the Search MCP tool of that name.
 */
export const searchPeopleServerTool: BaseServerTool = {
  name: 'search_people',
  inputSchema: searchPeopleInputSchema,
  async execute(raw, context?: ServerToolContext) {
    if (!context?.organizationId)
      return {
        success: false,
        message: 'The People directory is available only in organization conversations.',
      }
    try {
      const { query, personId, cursor } = searchPeopleInputSchema.parse(raw)
      const data = await executeCopilotPeopleRead(context, (scope) =>
        personId
          ? readDirectoryPerson({ ...scope, personId })
          : findDirectoryPeople({ ...scope, query, cursor })
      )
      return { success: true, data }
    } catch (error) {
      if (error instanceof z.ZodError)
        return {
          success: false,
          message: getValidationErrorMessage(error, 'Invalid people lookup arguments'),
        }
      logger.error('People lookup failed', { error })
      return {
        success: false,
        message: messageForCopilotApplicationError(error, 'People lookup failed'),
      }
    }
  },
}
