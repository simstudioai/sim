import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_CONTACT_WRITE_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_CONTACT_WRITE_OUTPUT_PROPERTIES,
  type MonacoContactWriteResponse,
  type MonacoUpsertContactParams,
} from '@/tools/monaco/types'
import {
  buildMonacoUpsertContactBody,
  MONACO_API_BASE,
  mapMonacoContactWrite,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoUpsertContactTool: ToolConfig<
  MonacoUpsertContactParams,
  MonacoContactWriteResponse
> = {
  id: 'monaco_upsert_contact',
  name: 'Monaco Upsert Contact',
  description:
    'Create a Monaco contact or update the one matching its email (case-insensitive), then LinkedIn URL. Pass a contact ID instead to update that contact by ID, which is how to change its email. Creating a contact enriches it and can take several seconds.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_CONTACT_WRITE_PARAMS,
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of an existing contact to update by ID instead of matching by email or LinkedIn URL; it is never created, and an unknown ID fails. Cannot be combined with account ID, domain, location, or inbound.',
    },
    clearFields: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields to clear on the contact, as an array or comma-separated list. Only applies with a contact ID. Allowed: first_name, last_name, email, title, phone_number, linkedin_url, notes.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/contacts/`,
    method: 'PUT',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoUpsertContactBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { contact: mapMonacoContactWrite(data.data) } }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'The created or updated contact',
      properties: MONACO_CONTACT_WRITE_OUTPUT_PROPERTIES,
    },
  },
}
