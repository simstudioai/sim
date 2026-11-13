import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import type {
  MonacoOpportunityContactsParams,
  MonacoOpportunityContactsResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  monacoHeaders,
  parseMonacoIdList,
  toMonacoStringArray,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoLinkOpportunityContactsTool: ToolConfig<
  MonacoOpportunityContactsParams,
  MonacoOpportunityContactsResponse
> = {
  id: 'monaco_link_opportunity_contacts',
  name: 'Monaco Link Opportunity Contacts',
  description:
    'Link one or more contacts to a Monaco opportunity. Contacts that are already linked are left as they are, and previously unlinked contacts are restored.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the opportunity to link contacts to',
    },
    contactIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'IDs of the contacts to link, as an array or comma-separated list. At most 500 IDs.',
      items: { type: 'string', description: 'Contact ID' },
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/opportunities/${safeUrlPathSegment(params.opportunityId, 'opportunityId')}/contacts`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => ({ contact_ids: parseMonacoIdList(params.contactIds, 'contactIds') }),
  },

  transformResponse: async (response) => {
    const data = toRecord(toRecord(await response.json()).data)
    return {
      success: true,
      output: {
        opportunityId: toStringOrNull(data.opportunity_id) ?? '',
        contactIds: toMonacoStringArray(data.contact_ids),
      },
    }
  },

  outputs: {
    opportunityId: {
      type: 'string',
      description: 'ID of the opportunity the contacts were linked to',
    },
    contactIds: {
      type: 'array',
      description: 'IDs of the contacts Monaco processed',
      items: { type: 'string', description: 'Contact ID' },
    },
  },
}
