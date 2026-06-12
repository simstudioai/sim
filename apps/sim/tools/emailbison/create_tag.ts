import type { EmailBisonCreateTagParams, EmailBisonTagResponse } from '@/tools/emailbison/types'
import {
  emailBisonBaseParamFields,
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
    ...emailBisonBaseParamFields,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tag name',
    },
  },
  request: {
    url: (params) => emailBisonUrl('/api/tags', {}, params.apiBaseUrl),
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
