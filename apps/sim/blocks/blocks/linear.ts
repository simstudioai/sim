import { LinearIcon } from '@/components/icons'
import type { LinearReadIssuesResponse } from '@/tools/linear/types'
import type { BlockConfig } from '../types'

export const LinearBlock: BlockConfig<LinearReadIssuesResponse> = {
  type: 'linear',
  name: 'Linear',
  description: 'Read and create issues in Linear',
  longDescription:
    'Integrate with Linear to fetch, filter, and create issues directly from your workflow.',
  category: 'tools',
  bgColor: '#5E6AD2',
  icon: LinearIcon,
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
      requiredScopes: [],
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
    },
    {
      id: 'projectId',
      title: 'Project',
      type: 'project-selector',
      layout: 'full',
      provider: 'linear',
      serviceId: 'linear',
      placeholder: 'Select a project',
    },
    {
      id: 'state',
      title: 'Issue State',
      type: 'dropdown',
      options: ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'],
      description: 'Filter by issue state',
      condition: { field: 'operation', value: ['read'] },
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      description: 'Search issues',
      condition: { field: 'operation', value: ['read'] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      description: 'Title for new issue',
      condition: { field: 'operation', value: ['write'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      description: 'Description for new issue',
      condition: { field: 'operation', value: ['write'] },
    },
  ],
  tools: {
    access: ['linear_read_issues', 'linear_create_issue'],
    config: {
      tool: (params) =>
        params.operation === 'write' ? 'linear_create_issue' : 'linear_read_issues',
      params: (params) => {
        if (params.operation === 'write') {
          return {
            credential: params.credential,
            teamId: params.teamId,
            projectId: params.projectId,
            title: params.title,
            description: params.description,
          }
        }
        return {
          credential: params.credential,
          teamId: params.teamId,
          projectId: params.projectId,
          state: params.state,
          search: params.search,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    teamId: { type: 'string', required: false },
    projectId: { type: 'string', required: false },
    state: { type: 'string', required: false },
    search: { type: 'string', required: false },
    title: { type: 'string', required: false },
    description: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        issues: 'json',
      },
    },
  },
}
