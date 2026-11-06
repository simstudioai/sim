import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutRunWorkflowParams,
  HelpScoutRunWorkflowResponse,
} from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  HELPSCOUT_API_BASE,
  parseHelpScoutId,
  toStringList,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

const MAX_CONVERSATIONS_PER_RUN = 50

function parseConversationIds(value: HelpScoutRunWorkflowParams['conversationIds']): number[] {
  const ids = toStringList(value).map((id) => parseHelpScoutId(id, 'conversationIds'))
  if (ids.length === 0) throw new Error('Provide at least one conversation ID')
  if (ids.length > MAX_CONVERSATIONS_PER_RUN) {
    throw new Error(`A workflow can run on at most ${MAX_CONVERSATIONS_PER_RUN} conversations`)
  }
  return ids
}

export const helpScoutRunWorkflowTool: ToolConfig<
  HelpScoutRunWorkflowParams,
  HelpScoutRunWorkflowResponse
> = {
  id: 'helpscout_run_workflow',
  name: 'Help Scout Run Workflow',
  description:
    'Run a manual Help Scout workflow on up to 50 conversations. The conversations must be in the same inbox as the workflow.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the manual workflow to run',
    },
    conversationIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated conversation IDs (up to 50)',
    },
  },
  request: {
    url: (params) =>
      `${HELPSCOUT_API_BASE}/workflows/${parseHelpScoutId(params.workflowId, 'workflowId')}/run`,
    method: 'POST',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => ({ conversationIds: parseConversationIds(params.conversationIds) }),
  },
  transformResponse: async (_response, params) => ({
    success: true,
    output: {
      workflowId: params ? parseHelpScoutId(params.workflowId, 'workflowId') : null,
      conversationIds: params ? parseConversationIds(params.conversationIds) : [],
    },
  }),
  outputs: {
    workflowId: { type: 'number', description: 'ID of the workflow that ran', nullable: true },
    conversationIds: {
      type: 'array',
      description: 'Conversations the workflow ran on',
      items: { type: 'number' },
    },
  },
}
