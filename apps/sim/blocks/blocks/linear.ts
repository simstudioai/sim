import { LinearIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { LinearResponse } from '@/tools/linear/types'

export const LinearBlock: BlockConfig<LinearResponse> = {
  type: 'linear',
  name: 'Linear',
  description: 'Read and create issues in Linear',
  longDescription:
    'Integrate with Linear to fetch, filter, and create issues directly from your workflow.',
  category: 'tools',
  icon: LinearIcon,
  bgColor: '#5E6AD2',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Issues', id: 'read' },
        { label: 'Create Issue', id: 'write' },
      ],
      value: () => 'read',
    },
    {
      id: 'credential',
      title: 'Linear Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'linear',
      serviceId: 'linear',
      requiredScopes: ['read', 'write'],
      placeholder: 'Select Linear account',
      required: true,
    },
    {
      id: 'teamId',
      title: 'Team',
      type: 'project-selector',
      layout: 'full',
      provider: 'linear',
      serviceId: 'linear',
      placeholder: 'Select a team',
      dependsOn: ['credential'],
      mode: 'basic',
    },
    {
      id: 'projectId',
      title: 'Project',
      type: 'project-selector',
      layout: 'full',
      provider: 'linear',
      serviceId: 'linear',
      placeholder: 'Select a project',
      dependsOn: ['credential', 'teamId'],
      mode: 'basic',
    },
    // Manual team ID input (advanced mode)
    {
      id: 'manualTeamId',
      title: 'Team ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Linear team ID',
      mode: 'advanced',
    },
    // Manual project ID input (advanced mode)
    {
      id: 'manualProjectId',
      title: 'Project ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Linear project ID',
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      layout: 'full',
      condition: { field: 'operation', value: ['write'] },
      required: true,
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      layout: 'full',
      condition: { field: 'operation', value: ['write'] },
    },
  ],
  tools: {
    access: ['linear_read_issues', 'linear_create_issue'],
    config: {
      tool: (params) =>
        params.operation === 'write' ? 'linear_create_issue' : 'linear_read_issues',
      params: (params) => {
        // Handle team ID (selector or manual)
        const effectiveTeamId = (params.teamId || params.manualTeamId || '').trim()

        // Handle project ID (selector or manual)
        const effectiveProjectId = (params.projectId || params.manualProjectId || '').trim()

        if (!effectiveTeamId) {
          throw new Error('Team ID is required. Please select a team or enter a team ID manually.')
        }
        if (!effectiveProjectId) {
          throw new Error(
            'Project ID is required. Please select a project or enter a project ID manually.'
          )
        }

        if (params.operation === 'write') {
          if (!params.title?.trim()) {
            throw new Error('Title is required for creating issues.')
          }
          if (!params.description?.trim()) {
            throw new Error('Description is required for creating issues.')
          }
          return {
            credential: params.credential,
            teamId: effectiveTeamId,
            projectId: effectiveProjectId,
            title: params.title,
            description: params.description,
          }
        }
        return {
          credential: params.credential,
          teamId: effectiveTeamId,
          projectId: effectiveProjectId,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Linear access token' },
    teamId: { type: 'string', description: 'Linear team identifier' },
    projectId: { type: 'string', description: 'Linear project identifier' },
    manualTeamId: { type: 'string', description: 'Manual team identifier' },
    manualProjectId: { type: 'string', description: 'Manual project identifier' },
    title: { type: 'string', description: 'Issue title' },
    description: { type: 'string', description: 'Issue description' },
  },
  outputs: {
    issues: { type: 'json', description: 'Issues list' },
    issue: { type: 'json', description: 'Single issue data' },
  },
}
