import {
  mapProject,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneProjectResponse,
  type RocketlaneUpdateProjectParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUpdateProjectTool: ToolConfig<
  RocketlaneUpdateProjectParams,
  RocketlaneProjectResponse
> = {
  id: 'rocketlane_update_project',
  name: 'Rocketlane Update Project',
  description:
    'Update a Rocketlane project by ID, including name, dates, visibility, owner, status, and custom fields',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the project to update',
    },
    projectName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the project',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date on which the project begins (YYYY-MM-DD)',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Date on which the project is planned to complete (YYYY-MM-DD, on or after startDate)',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can see the project: EVERYONE or MEMBERS',
    },
    ownerUserId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User ID of the new project owner (transfers ownership and revokes access for the previous owner)',
    },
    ownerEmailId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email of the new project owner',
    },
    statusValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Value (identifier) of the project status',
    },
    fields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom field assignments, each with fieldId and fieldValue (string, number, or number array matching the field type)',
      items: {
        type: 'object',
        description: 'Custom field assignment',
        properties: {
          fieldId: { type: 'number', description: 'Unique identifier of the field' },
          fieldValue: {
            type: 'string',
            description: 'Value of the field (string, number, or number array)',
          },
        },
      },
    },
    annualizedRecurringRevenue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recurring revenue of the customer subscriptions for a single calendar year',
    },
    projectFee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total fee charged for the project',
    },
    autoAllocation: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether auto allocation is enabled for the project',
    },
    budgetedHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total hours allocated for project execution (decimal, up to two places)',
    },
    externalReferenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identifier linking the project to an external system',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to return in the response (e.g. budgetedHours,progressPercentage)',
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response body',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}`
      )
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null)
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      return url.toString()
    },
    method: 'PUT',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.projectName) body.projectName = params.projectName
      if (params.startDate) body.startDate = params.startDate
      if (params.dueDate) body.dueDate = params.dueDate
      if (params.visibility) body.visibility = params.visibility
      const owner: Record<string, unknown> = {}
      if (params.ownerUserId != null) owner.userId = params.ownerUserId
      if (params.ownerEmailId) owner.emailId = params.ownerEmailId
      if (Object.keys(owner).length > 0) body.owner = owner
      if (params.statusValue != null) body.status = { value: params.statusValue }
      if (params.fields && params.fields.length > 0) body.fields = params.fields
      if (params.annualizedRecurringRevenue != null)
        body.annualizedRecurringRevenue = params.annualizedRecurringRevenue
      if (params.projectFee != null) body.projectFee = params.projectFee
      if (params.autoAllocation != null) body.autoAllocation = params.autoAllocation
      if (params.budgetedHours != null) body.budgetedHours = params.budgetedHours
      if (params.externalReferenceId) body.externalReferenceId = params.externalReferenceId
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { project: mapProject(data) },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The updated project',
      properties: PROJECT_OUTPUT_PROPERTIES,
    },
  },
}
