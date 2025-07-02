import { LinearIcon } from '@/components/icons'
import type { LinearCreateIssueResponse, LinearReadIssuesResponse } from '@/tools/linear/types'
import type { BlockConfig } from '../types'

type LinearResponse = LinearReadIssuesResponse | LinearCreateIssueResponse

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
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    teamId: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    title: { type: 'string', required: false },
    description: { type: 'string', required: false },
  },
  outputs: {
    issues: 'json',
    issue: 'json',
  },
}
