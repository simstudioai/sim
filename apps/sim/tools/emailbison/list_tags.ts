import type { EmailBisonBaseParams, EmailBisonListTagsResponse } from '@/tools/emailbison/types'
import {
  emailBisonArrayData,
  emailBisonHeaders,
  emailBisonUrl,
  listTagsOutputs,
  mapTag,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const listTagsTool: ToolConfig<EmailBisonBaseParams, EmailBisonListTagsResponse> = {
  id: 'emailbison_list_tags',
  name: 'Email Bison List Tags',
  description: 'Retrieves all Email Bison tags for the authenticated workspace.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email Bison API token',
    },
  },
  request: {
    url: () => emailBisonUrl('/api/tags'),
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
