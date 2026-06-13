import type {
  TriggerDevPromoteDeploymentParams,
  TriggerDevPromoteDeploymentResponse,
} from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevPromoteDeploymentTool: ToolConfig<
  TriggerDevPromoteDeploymentParams,
  TriggerDevPromoteDeploymentResponse
> = {
  id: 'trigger_dev_promote_deployment',
  name: 'Trigger.dev Promote Deployment',
  description:
    'Promote a Trigger.dev deployment version so new runs execute on it (e.g., to roll back to a previous version).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    version: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Deployment version to promote (e.g., "20250228.1")',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/deployments/${encodeURIComponent(params.version.trim())}/promote`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        version: data.version ?? null,
        shortCode: data.shortCode ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the promoted deployment' },
    version: {
      type: 'string',
      description: 'Version of the promoted deployment',
      optional: true,
    },
    shortCode: {
      type: 'string',
      description: 'Short code of the promoted deployment',
      optional: true,
    },
  },
}
