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
        { label: 'Read Issues', id: 'read-bulk' },
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
    // Add assignee, label, priority, etc. as needed
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
            // Add assigneeId, labelIds, etc. if supported
          }
        }
        // read-bulk
        return {
          credential: params.credential,
          teamId: params.teamId,
          projectId: params.projectId,
          // Add assigneeId, labelId, etc. if supported
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    teamId: { type: 'string', required: false },
    projectId: { type: 'string', required: false },
    title: { type: 'string', required: false },
    description: { type: 'string', required: false },
    // Add assigneeId, labelIds, etc. as needed
  },
  outputs: {
    response: {
      type: {
        issues: 'json', // For read-bulk
        issue: 'json', // For write
      },
    },
  },
}
