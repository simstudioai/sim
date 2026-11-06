import { toNumberOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutGetCurrentUserParams,
  HelpScoutGetCurrentUserResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_USER_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  HELPSCOUT_API_BASE,
  projectUser,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutGetCurrentUserTool: ToolConfig<
  HelpScoutGetCurrentUserParams,
  HelpScoutGetCurrentUserResponse
> = {
  id: 'helpscout_get_current_user',
  name: 'Help Scout Get Current User',
  description: 'Get the Help Scout user the connection acts as, and its company ID.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
  },
  request: {
    url: `${HELPSCOUT_API_BASE}/users/me`,
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: { user: projectUser(data), companyId: toNumberOrNull(data.companyId) },
    }
  },
  outputs: {
    user: { type: 'json', description: 'Connected user', properties: HELPSCOUT_USER_PROPERTIES },
    companyId: { type: 'number', description: 'Help Scout company ID', nullable: true },
  },
}
