import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_AUDIENCE_CONTACT_FAILURES_OUTPUT,
  type MonacoAddAudienceContactsResponse,
  type MonacoAudienceContactsParams,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoAudienceContactFailures,
  monacoHeaders,
  parseMonacoIdList,
  toMonacoStringArray,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoAddAudienceContactsTool: ToolConfig<
  MonacoAudienceContactsParams,
  MonacoAddAudienceContactsResponse
> = {
  id: 'monaco_add_audience_contacts',
  name: 'Monaco Add Audience Contacts',
  description:
    'Add contacts to a Monaco audience by ID. Audiences can be attached to multiple campaigns, so adding a contact here enrolls them in every campaign that uses this audience, which can start real email and LinkedIn outreach.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the audience to add contacts to',
    },
    contactIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'IDs of the contacts to add (1 to 10,000), as an array or comma-separated list',
      items: { type: 'string' },
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/audiences/${safeUrlPathSegment(params.audienceId, 'audienceId')}/contacts`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => ({ contact_ids: parseMonacoIdList(params.contactIds, 'contactIds') }),
  },

  transformResponse: async (response) => {
    const result = toRecord(toRecord(await response.json()).data)
    return {
      success: true,
      output: {
        audienceId: toStringOrNull(result.audience_id) ?? '',
        addedCount: toNumberOrNull(result.added_count) ?? 0,
        failures: mapMonacoAudienceContactFailures(result.failures),
        unknownContactIds: toMonacoStringArray(result.unknown_contact_ids),
      },
    }
  },

  outputs: {
    audienceId: { type: 'string', description: 'ID of the audience that was modified' },
    addedCount: {
      type: 'number',
      description: 'Number of contacts this call added to the audience',
    },
    failures: MONACO_AUDIENCE_CONTACT_FAILURES_OUTPUT,
    unknownContactIds: {
      type: 'array',
      description: 'Contact IDs that do not exist in the organization and were skipped',
      items: { type: 'string', description: 'Contact ID' },
    },
  },
}
