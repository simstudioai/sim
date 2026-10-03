import type {
  UpdateSyntheticsStatusParams,
  UpdateSyntheticsStatusResponse,
} from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const updateSyntheticsStatusTool: ToolConfig<
  UpdateSyntheticsStatusParams,
  UpdateSyntheticsStatusResponse
> = {
  id: 'datadog_update_synthetics_status',
  name: 'Datadog Pause Or Start Synthetic Test',
  description: 'Pause or resume a Synthetic test by setting its status to "paused" or "live".',
  version: '1.0.0',

  params: {
    publicId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The public ID of the Synthetic test to update',
    },
    newStatus: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New status: "live" to start the test or "paused" to pause it',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) =>
      datadogApiUrl(
        params.site,
        `/api/v1/synthetics/tests/${datadogPathSegment(params.publicId)}/status`
      ),
    method: 'PUT',
    headers: datadogHeaders,
    body: (params) => ({ new_status: params.newStatus }),
  },

  transformResponse: async (response: Response, params) => {
    const status = params?.newStatus

    if (!response.ok) {
      return {
        success: false,
        output: { success: false, status },
        error: await datadogErrorMessage(response),
      }
    }

    const updated = await response.json().catch(() => false)

    return {
      success: true,
      output: {
        success: updated === true,
        status,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether Datadog reported the status update as successful',
    },
    status: {
      type: 'string',
      description: 'The status that was requested: live or paused',
    },
  },
}
