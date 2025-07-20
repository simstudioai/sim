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
    },
    {
      id: 'teamId',
      title: 'Team',
      type: 'project-selector',
      layout: 'full',
      provider: 'linear',
      serviceId: 'linear',
      placeholder: 'Select a team',
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
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    teamId: { type: 'string', required: false },
    projectId: { type: 'string', required: false },
    manualTeamId: { type: 'string', required: false },
    manualProjectId: { type: 'string', required: false },
    title: { type: 'string', required: false },
    description: { type: 'string', required: false },
  },
  outputs: {
    issues: 'json',
    issue: 'json',
  },
}
