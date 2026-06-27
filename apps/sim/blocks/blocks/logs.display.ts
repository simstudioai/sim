import { Library } from '@/components/emcn/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const LogsBlockDisplay = {
  type: 'logs',
  name: 'Logs',
  description: 'Query workflow execution logs',
  category: 'blocks',
  bgColor: '#EAB308',
  icon: Library,
  longDescription:
    'Search workflow execution logs in the current workspace, fetch a single log by id, or load full execution details with the per-block state snapshot.',
  docsLink: 'https://docs.sim.ai/api-reference/logs/getExecutionDetails',
  hideFromToolbar: true,
} satisfies BlockDisplay

export const LogsV2BlockDisplay = {
  type: 'logs_v2',
  name: 'Logs',
  description: 'Query workflow runs and fetch run details',
  category: 'blocks',
  bgColor: '#EAB308',
  icon: Library,
  longDescription:
    'Query workflow run logs in the current workspace with the same filters as the Logs page, returning matching run IDs. Fetch full details for a single run, including its trace spans.',
  docsLink: 'https://docs.sim.ai/integrations/logs',
} satisfies BlockDisplay
