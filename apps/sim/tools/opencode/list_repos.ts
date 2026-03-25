import type { OpenCodeListReposResponse } from '@/tools/opencode/types'
import type { ToolConfig } from '@/tools/types'

export const openCodeListReposTool: ToolConfig<Record<string, never>, OpenCodeListReposResponse> = {
  id: 'opencode_list_repos',
  name: 'OpenCode List Repositories',
  description: 'List the repositories currently available in the internal OpenCode server.',
  version: '1.0.0',

  params: {},

  request: {
    url: '/api/tools/opencode/repos',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  outputs: {
    repositories: {
      type: 'array',
      description: 'Repositories available in OpenCode.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Repository identifier' },
          label: { type: 'string', description: 'Repository label' },
          directory: { type: 'string', description: 'Absolute directory mounted in OpenCode' },
          projectId: {
            type: 'string',
            description:
              'OpenCode project identifier when registered, otherwise a configured fallback',
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of repositories returned' },
  },
}
