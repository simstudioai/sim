import type { JamaGetCurrentUserParams, JamaGetCurrentUserResponse } from '@/tools/jama/types'
import {
  JAMA_RETRY,
  JAMA_USER_PROPERTIES,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaOAuth,
  jamaUrl,
  mapJamaUser,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetCurrentUserTool: ToolConfig<
  JamaGetCurrentUserParams,
  JamaGetCurrentUserResponse
> = {
  id: 'jama_get_current_user',
  name: 'Jama Get Current User',
  description: "Get Current User in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
  },
  request: {
    url: (params) => jamaUrl(params.instanceUrl, '/users/current', {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { user: mapJamaUser(jamaData(body)) } }
  },
  outputs: {
    user: {
      type: 'object',
      description: 'Get Current User result',
      properties: JAMA_USER_PROPERTIES,
    },
  },
}
