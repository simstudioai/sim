import type { AshbyApplication } from '@/tools/ashby/types'
import {
  APPLICATION_OUTPUTS,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  mapApplication,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyChangeApplicationSourceParams {
  apiKey: string
  applicationId: string
  sourceId?: string
  unsetSource?: boolean
}

interface AshbyChangeApplicationSourceResponse extends ToolResponse {
  output: AshbyApplication
}

export const changeApplicationSourceTool: ToolConfig<
  AshbyChangeApplicationSourceParams,
  AshbyChangeApplicationSourceResponse
> = {
  id: 'ashby_change_application_source',
  name: 'Ashby Change Application Source',
  description:
    'Changes the source attributed to an existing application, so programmatically created applications report correctly on the recruiting side. Requires the candidatesWrite permission.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UUID of the application whose source should change',
    },
    sourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UUID of the source to attribute the application to, as returned by List Sources. Omit only when unsetSource is true.',
    },
    unsetSource: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set true to deliberately clear the application source. Required to unset, so that a missing or empty sourceId cannot wipe attribution by accident.',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.changeSource',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    /**
     * Ashby requires `sourceId` to be present even when unsetting, so it always
     * serializes - but the value has to say what the caller actually meant. The
     * endpoint has no "leave unchanged" mode, so setting and clearing are the
     * only two intents, and exactly one of them must be expressed:
     *
     * - neither given: an omitted sourceId would otherwise wipe attribution on a
     *   real application and still report success
     * - both given: preferring either one silently discards the other, which is
     *   how "clear this" turns into a set nobody asked for
     *
     * Both are caller errors rather than something to resolve by precedence.
     */
    body: (params) => {
      const sourceId = params.sourceId?.trim()
      if (sourceId && params.unsetSource) {
        throw new Error(
          'Ashby source ID and unsetSource are mutually exclusive. Provide a source ID to attribute the application, or set unsetSource on its own to clear it.'
        )
      }
      if (!sourceId && !params.unsetSource) {
        throw new Error(
          'Ashby source ID is required. Set unsetSource to true to deliberately clear the application source.'
        )
      }
      return {
        applicationId: params.applicationId.trim(),
        sourceId: sourceId ? sourceId : null,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to change application source'))
    }

    return {
      success: true,
      output: mapApplication(data.results),
    }
  },

  outputs: APPLICATION_OUTPUTS,
}
