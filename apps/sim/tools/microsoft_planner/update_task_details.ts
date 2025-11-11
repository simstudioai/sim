import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdateTaskDetailsResponse,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerUpdateTaskDetails')

export const updateTaskDetailsTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdateTaskDetailsResponse
> = {
  id: 'microsoft_planner_update_task_details',
  name: 'Update Microsoft Planner Task Details',
  description:
    'Update task details including description, checklist items, and references in Microsoft Planner',
  version: '1.0',
  errorExtractor: 'nested-error-object',

  oauth: {
    required: true,
    provider: 'microsoft-planner',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Planner API',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the task',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ETag value from the task details to update (If-Match header)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The description of the task',
    },
    checklist: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Checklist items as a JSON object',
    },
    references: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'References as a JSON object',
    },
    previewType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Preview type: automatic, noPreview, checklist, description, or reference',
    },
  },

  request: {
    url: (params) => {
      if (!params.taskId) {
        throw new Error('Task ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/tasks/${params.taskId}/details`
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      if (!params.etag) {
        throw new Error('ETag is required for update operations')
      }

      let cleanedEtag = params.etag.trim()

      logger.info('ETag processing:', {
        original: params.etag,
        originalLength: params.etag.length,
      })

      while (cleanedEtag.startsWith('"') && cleanedEtag.endsWith('"')) {
        cleanedEtag = cleanedEtag.slice(1, -1)
        logger.info('Removed surrounding quotes:', cleanedEtag)
      }

      if (cleanedEtag.includes('\\"')) {
        cleanedEtag = cleanedEtag.replace(/\\"/g, '"')
        logger.info('Unescaped quotes:', cleanedEtag)
      }

      if (!/^W\/".+"$/.test(cleanedEtag)) {
        logger.warn(
          'Unexpected ETag format for If-Match. For plannerTaskDetails, use the ETag from GET /planner/tasks/{id}/details.',
          {
            cleanedEtag,
          }
        )
      }

      logger.info(`Using If-Match header: ${cleanedEtag}`)

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        'If-Match': cleanedEtag,
      }
    },
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.description !== undefined) {
        body.description = params.description
      }

      if (params.checklist) {
        body.checklist = params.checklist
      }

      if (params.references) {
        body.references = params.references
      }

      if (params.previewType) {
        body.previewType = params.previewType
      }

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      logger.info('Updating task details with body:', body)
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const taskDetails = await response.json()
    logger.info('Updated task details:', taskDetails)

    const result: MicrosoftPlannerUpdateTaskDetailsResponse = {
      success: true,
      output: {
        taskDetails,
        metadata: {
          taskId: taskDetails.id,
        },
      },
    }

    return result
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the task details were updated successfully',
    },
    taskDetails: {
      type: 'object',
      description: 'The updated task details object with all properties',
    },
    metadata: { type: 'object', description: 'Metadata including taskId' },
  },
}
