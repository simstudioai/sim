import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_CONTACT_WRITE_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_CONTACT_OUTPUT_PROPERTIES,
  type MonacoUpdateContactParams,
  type MonacoUpdateContactResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoUpdateContactBody,
  MONACO_API_BASE,
  mapMonacoContact,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoUpdateContactTool: ToolConfig<
  MonacoUpdateContactParams,
  MonacoUpdateContactResponse
> = {
  id: 'monaco_update_contact',
  name: 'Monaco Update Contact',
  description: 'Update fields on an existing Monaco contact by ID. Only the fields sent change.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the contact to update',
    },
    firstName: MONACO_CONTACT_WRITE_PARAMS.firstName,
    lastName: MONACO_CONTACT_WRITE_PARAMS.lastName,
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the contact (max 255 characters)',
    },
    title: MONACO_CONTACT_WRITE_PARAMS.title,
    phoneNumber: MONACO_CONTACT_WRITE_PARAMS.phoneNumber,
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL (a linkedin.com/in/... URL)',
    },
    location: MONACO_CONTACT_WRITE_PARAMS.location,
    notes: MONACO_CONTACT_WRITE_PARAMS.notes,
    doNotContact: MONACO_CONTACT_WRITE_PARAMS.doNotContact,
    tags: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        "Tag IDs for the contact, as an array or comma-separated list. Replaces the contact's existing tags.",
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country of the contact, as a country name or code (max 128 characters)',
    },
    jobStartDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Start date of the contact's current job (YYYY-MM-DD)",
    },
    clearFields: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields to clear on the contact, as an array or comma-separated list. Allowed: first_name, last_name, email, title, phone_number, linkedin_url, notes.',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom field values to set, as a JSON object keyed by `custom_field_<id>` (e.g. {"custom_field_<id>": "value"}). Custom fields are always updatable; use Get Field Schemas to find the keys.',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/contacts/${safeUrlPathSegment(params.contactId, 'contactId')}`,
    method: 'PATCH',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoUpdateContactBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { contact: mapMonacoContact(data.data) } }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'The updated contact',
      properties: MONACO_CONTACT_OUTPUT_PROPERTIES,
    },
  },
}
