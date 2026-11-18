import { toNumberOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import type {
  MonacoEnrollCampaignContactsParams,
  MonacoEnrollCampaignContactsResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoEnrollFailureReasons,
  monacoHeaders,
  parseMonacoIdList,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const MAX_AUDIENCE_NAME_LENGTH = 255

export const monacoEnrollCampaignContactsTool: ToolConfig<
  MonacoEnrollCampaignContactsParams,
  MonacoEnrollCampaignContactsResponse
> = {
  id: 'monaco_enroll_campaign_contacts',
  name: 'Monaco Enroll Campaign Contacts',
  description:
    'Enroll contacts in a Monaco campaign. This sends real outreach: enrolled contacts are placed on the campaign sequence, which sends real emails and LinkedIn messages. Monaco always creates a new audience with the given name, attaches it to the campaign, and adds the contacts to it. The campaign must be active or paused. Sequences are created asynchronously, so contacts already enrolled are deduplicated later and still count as successes.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    campaignId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the campaign to enroll contacts in; it must be active or paused',
    },
    audienceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Name for the new audience created to hold these contacts (1 to 255 characters); pick something short and relevant to the enrollment. Must be unique within the organization: a duplicate name is rejected, so vary it and retry.',
    },
    contactIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'IDs of the contacts to enroll (1 to 10,000), as an array or comma-separated list',
      items: { type: 'string' },
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/campaigns/${safeUrlPathSegment(params.campaignId, 'campaignId')}/enroll`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const audienceName = params.audienceName.trim()
      if (!audienceName) throw new Error('audienceName is required')
      if (audienceName.length > MAX_AUDIENCE_NAME_LENGTH) {
        throw new Error(`audienceName must be at most ${MAX_AUDIENCE_NAME_LENGTH} characters`)
      }
      return {
        audience_name: audienceName,
        contact_ids: parseMonacoIdList(params.contactIds, 'contactIds'),
      }
    },
  },

  transformResponse: async (response) => {
    const result = toRecord(toRecord(await response.json()).data)
    return {
      success: true,
      output: {
        successCount: toNumberOrNull(result.success_count) ?? 0,
        failureCount: toNumberOrNull(result.failure_count) ?? 0,
        failureReasons: mapMonacoEnrollFailureReasons(result.failure_reasons),
      },
    }
  },

  outputs: {
    successCount: {
      type: 'number',
      description: "Contacts added to the campaign's new audience",
    },
    failureCount: {
      type: 'number',
      description: 'Contacts that could not be added (e.g. not found in the organization)',
    },
    failureReasons: {
      type: 'array',
      description: 'Failure reasons with the number of contacts affected by each',
      items: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Failure reason code (e.g. contact_has_active_sequence)',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of the failure reason',
          },
          count: { type: 'number', description: 'Number of contacts that hit this failure' },
        },
      },
    },
  },
}
