import type {
  MintlifyTriggerAutomationParams,
  MintlifyTriggerAutomationResponse,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyTriggerAutomationTool: ToolConfig<
  MintlifyTriggerAutomationParams,
  MintlifyTriggerAutomationResponse
> = {
  id: 'mintlify_trigger_automation',
  name: 'Mintlify Trigger Automation',
  description:
    'Run a scheduled Mintlify automation immediately instead of waiting for its next scheduled time. Only automations with a custom schedule can be triggered.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    automationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Automation ID, copied from the automation's settings panel on the Automations page",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) =>
      `${MINTLIFY_API_BASE}/v1/workflow/${pathSegment(params.projectId)}/${pathSegment(params.automationId)}/trigger`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to trigger Mintlify automation')

    return {
      success: true,
      output: {
        schemaId: toNullableString(data.schemaId),
        instanceId: toNullableString(data.instanceId),
        jobId: toNullableString(data.jobId),
      },
    }
  },

  outputs: {
    schemaId: { type: 'string', description: 'ID of the triggered automation', nullable: true },
    instanceId: {
      type: 'string',
      description: 'ID of the queued automation run, visible in the run history',
      nullable: true,
    },
    jobId: {
      type: 'string',
      description: 'ID of the background job processing the run',
      nullable: true,
    },
  },
}
