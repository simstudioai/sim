import type { EmailBisonBaseParams, EmailBisonListTagsResponse } from '@/tools/emailbison/types'
import {
  emailBisonArrayData,
  emailBisonBaseParamFields,
  emailBisonHeaders,
  emailBisonUrl,
  listTagsOutputs,
  mapTag,
} from '@/tools/emailbison/utils'
import { EMAILBISON_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const listTagsTool: ToolConfig<EmailBisonBaseParams, EmailBisonListTagsResponse> = {
  id: 'emailbison_list_tags',
  name: 'Email Bison List Tags',
  description: 'Retrieves all Email Bison tags for the authenticated workspace.',
  version: '1.0.0',
  oauth: EMAILBISON_CREDENTIAL_OAUTH,
  params: {
    ...emailBisonBaseParamFields,
  },
  request: {
    url: (params) => emailBisonUrl('/api/tags', {}, params.apiBaseUrl),
    method: 'GET',
    headers: emailBisonHeaders,
  },
  transformResponse: async (response) => {
    const data = await emailBisonArrayData(response, 'tags')
    const tags = data.map(mapTag)

    return {
      success: true,
      output: {
        tags,
        count: tags.length,
      },
    }
  },
  outputs: listTagsOutputs,
}
