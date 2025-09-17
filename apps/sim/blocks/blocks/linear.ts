import { LinearIcon } from '@/components/icons'
import type { BlockConfig, BlockIcon } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { LinearResponse } from '@/tools/linear/types'

const LinearBlockIcon: BlockIcon = (props) => LinearIcon(props as any)

export const LinearBlock: BlockConfig<LinearResponse> = {
  type: 'linear',
  name: 'Linear',
  description: 'Read and create issues in Linear',
  authMode: AuthMode.OAuth,
  longDescription: 'Integrate Linear into the workflow. Can read and create issues.',
  category: 'tools',
  icon: LinearBlockIcon,
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
      canonicalParamId: 'teamId',
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
      canonicalParamId: 'projectId',
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
      canonicalParamId: 'teamId',
      placeholder: 'Enter Linear team ID',
      mode: 'advanced',
    },
    // Manual project ID input (advanced mode)
    {
      id: 'manualProjectId',
      title: 'Project ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'projectId',
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
        // Handle both selector and manual inputs
        const effectiveTeamId = (params.teamId || params.manualTeamId || '').trim()
        const effectiveProjectId = (params.projectId || params.manualProjectId || '').trim()

        if (!effectiveTeamId) {
          throw new Error('Team ID is required.')
        }
        if (!effectiveProjectId) {
          throw new Error('Project ID is required.')
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
