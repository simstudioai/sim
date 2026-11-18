import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_AUDIENCE_CONTACT_FAILURES_OUTPUT,
  type MonacoAudienceContactsParams,
  type MonacoRemoveAudienceContactsResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoAudienceContactFailures,
  monacoHeaders,
  parseMonacoIdList,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoRemoveAudienceContactsTool: ToolConfig<
  MonacoAudienceContactsParams,
  MonacoRemoveAudienceContactsResponse
> = {
  id: 'monaco_remove_audience_contacts',
  name: 'Monaco Remove Audience Contacts',
  description:
    'Remove contacts from a Monaco audience by ID. Idempotent: IDs not in the audience are ignored. Per-contact failures are returned in failures.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the audience to remove contacts from',
    },
    contactIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'IDs of the contacts to remove (1 to 10,000), as an array or comma-separated list',
      items: { type: 'string' },
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/audiences/${safeUrlPathSegment(params.audienceId, 'audienceId')}/contacts/remove`,
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
        failures: mapMonacoAudienceContactFailures(result.failures),
      },
    }
  },

  outputs: {
    audienceId: { type: 'string', description: 'ID of the audience that was modified' },
    failures: MONACO_AUDIENCE_CONTACT_FAILURES_OUTPUT,
  },
}
