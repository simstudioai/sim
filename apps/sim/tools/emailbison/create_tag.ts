import type { EmailBisonCreateTagParams, EmailBisonTagResponse } from '@/tools/emailbison/types'
import {
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  jsonBody,
  mapTag,
  tagOutputs,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const createTagTool: ToolConfig<EmailBisonCreateTagParams, EmailBisonTagResponse> = {
  id: 'emailbison_create_tag',
  name: 'Email Bison Create Tag',
  description: 'Creates a new Email Bison tag.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email Bison API token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tag name',
    },
  },
  request: {
    url: () => emailBisonUrl('/api/tags'),
    method: 'POST',
    headers: emailBisonHeaders,
    body: (params) => jsonBody({ name: params.name }),
  },
  transformResponse: async (response) => {
    const data = await emailBisonRecordData(response, 'tag')

    return {
      success: true,
      output: mapTag(data),
    }
  },
  outputs: tagOutputs,
}
