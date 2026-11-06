import type {
  GreenhouseUnrejectApplicationV2Params,
  GreenhouseUnrejectApplicationV2Response,
} from '@/tools/greenhouse/types'
import { greenhouseHeaders, readGreenhouseEmpty } from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseUnrejectApplicationV2Tool: ToolConfig<
  GreenhouseUnrejectApplicationV2Params,
  GreenhouseUnrejectApplicationV2Response
> = {
  id: 'greenhouse_unreject_application_v2',
  name: 'Greenhouse Unreject Application',
  description:
    'Restores a rejected application to its previous stage and clears its rejection reason and notes.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Greenhouse resource ID',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/applications/${safeUrlPathSegment(params.id, 'id')}/unreject`,
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    await readGreenhouseEmpty(response)
    return { success: true, output: {} }
  },
  outputs: {},
}
