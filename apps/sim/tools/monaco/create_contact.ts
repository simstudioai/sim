import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_CONTACT_WRITE_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_CONTACT_WRITE_OUTPUT_PROPERTIES,
  type MonacoContactWriteResponse,
  type MonacoCreateContactParams,
} from '@/tools/monaco/types'
import {
  buildMonacoCreateContactBody,
  MONACO_API_BASE,
  mapMonacoContactWrite,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoCreateContactTool: ToolConfig<
  MonacoCreateContactParams,
  MonacoContactWriteResponse
> = {
  id: 'monaco_create_contact',
  name: 'Monaco Create Contact',
  description:
    'Create a Monaco contact from an email or LinkedIn URL. Monaco enriches the contact and resolves or creates its account, which can take several seconds. A duplicate email or LinkedIn URL is rejected; use Upsert Contact to update a match instead.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_CONTACT_WRITE_PARAMS,
  },

  request: {
    url: `${MONACO_API_BASE}/v1/contacts/`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoCreateContactBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { contact: mapMonacoContactWrite(data.data) } }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'The created contact',
      properties: MONACO_CONTACT_WRITE_OUTPUT_PROPERTIES,
    },
  },
}
