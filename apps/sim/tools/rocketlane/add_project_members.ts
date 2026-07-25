import {
  mapProject,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneAddProjectMembersParams,
  type RocketlaneProjectResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneAddProjectMembersTool: ToolConfig<
  RocketlaneAddProjectMembersParams,
  RocketlaneProjectResponse
> = {
  id: 'rocketlane_add_project_members',
  name: 'Rocketlane Add Project Members',
  description: 'Add team members and customer stakeholders to a Rocketlane project',
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
      description: 'Unique identifier of the project',
    },
    memberUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of team members from your organization to add',
      items: { type: 'number', description: 'User ID of a team member' },
    },
    memberEmailIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emails of team members from your organization to add',
      items: { type: 'string', description: 'Email of a team member' },
    },
    customerUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of customer stakeholders to add',
      items: { type: 'number', description: 'User ID of a customer' },
    },
    customerEmailIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emails of customer stakeholders to add',
      items: { type: 'string', description: 'Email of a customer' },
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}/add-members`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      const members = [
        ...(params.memberUserIds ?? []).map((userId) => ({ userId })),
        ...(params.memberEmailIds ?? []).map((emailId) => ({ emailId })),
      ]
      if (members.length > 0) body.members = members
      const customers = [
        ...(params.customerUserIds ?? []).map((userId) => ({ userId })),
        ...(params.customerEmailIds ?? []).map((emailId) => ({ emailId })),
      ]
      if (customers.length > 0) body.customers = customers
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
      description: 'The project with its updated team members',
      properties: PROJECT_OUTPUT_PROPERTIES,
    },
  },
}
