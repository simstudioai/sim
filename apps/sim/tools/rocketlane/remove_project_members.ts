import {
  mapProject,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneProjectResponse,
  type RocketlaneRemoveProjectMembersParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneRemoveProjectMembersTool: ToolConfig<
  RocketlaneRemoveProjectMembersParams,
  RocketlaneProjectResponse
> = {
  id: 'rocketlane_remove_project_members',
  name: 'Rocketlane Remove Project Members',
  description: 'Remove team members from a Rocketlane project',
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
      description:
        'User IDs of team members to remove (at least one of memberUserIds or memberEmailIds is required)',
      items: { type: 'number', description: 'User ID of a team member' },
    },
    memberEmailIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Emails of team members to remove (at least one of memberUserIds or memberEmailIds is required)',
      items: { type: 'string', description: 'Email of a team member' },
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}/remove-members`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const members = [
        ...(params.memberUserIds ?? []).map((userId) => ({ userId })),
        ...(params.memberEmailIds ?? []).map((emailId) => ({ emailId })),
      ]
      return { members }
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
