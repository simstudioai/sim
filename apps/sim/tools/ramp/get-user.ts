import type { RampGetUserParams, RampGetUserResponse } from '@/tools/ramp/types'
import { RAMP_USER_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectUser } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetUserTool: ToolConfig<RampGetUserParams, RampGetUserResponse> = {
  id: 'ramp_get_user',
  name: 'Ramp Get User',
  description: 'Fetch a user in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    user_id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'User id' },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/users/${safeUrlPathSegment(params.user_id, 'user_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { user: projectUser(data) } }
  },
  outputs: {
    user: { type: 'json', description: 'User details', properties: RAMP_USER_PROPERTIES },
  },
}
