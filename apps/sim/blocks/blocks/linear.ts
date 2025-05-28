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
  subBlocks: [],
  tools: {
    access: ['linear_read_issues', 'linear_create_issue'],
  },
  inputs: {
    teamId: { type: 'string', required: false, description: 'Linear team ID' },
    projectId: { type: 'string', required: false, description: 'Linear project ID' },
    state: { type: 'string', required: false, description: 'Issue state' },
    search: { type: 'string', required: false, description: 'Search query' },
    title: { type: 'string', required: false, description: 'Issue title (for create)' },
    description: { type: 'string', required: false, description: 'Issue description (for create)' },
  },
  outputs: {
    response: {
      type: {
        issues: 'json',
      },
    },
  },
}
