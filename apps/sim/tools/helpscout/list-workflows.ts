import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListWorkflowsParams,
  HelpScoutListWorkflowsResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_WORKFLOW_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  parseOptionalHelpScoutId,
  projectPage,
  projectWorkflow,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListWorkflowsTool: ToolConfig<
  HelpScoutListWorkflowsParams,
  HelpScoutListWorkflowsResponse
> = {
  id: 'helpscout_list_workflows',
  name: 'Help Scout List Workflows',
  description:
    'List Help Scout workflows, optionally filtered by inbox or by type (manual or automatic).',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    mailboxId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inbox ID to filter by',
    },
    workflowType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'manual or automatic',
    },
    page: PAGE_PARAM,
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl('/workflows', {
        mailboxId: parseOptionalHelpScoutId(params.mailboxId, 'mailboxId'),
        type: params.workflowType?.trim(),
        page: validatePage(params.page),
      }),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        workflows: embeddedList(data, 'workflows').map(projectWorkflow),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    workflows: {
      type: 'array',
      description: 'Workflows on this page',
      items: { type: 'object', properties: HELPSCOUT_WORKFLOW_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
