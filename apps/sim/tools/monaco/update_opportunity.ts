import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_OPPORTUNITY_OUTPUT_PROPERTIES,
  type MonacoOpportunityResponse,
  type MonacoUpdateOpportunityParams,
} from '@/tools/monaco/types'
import {
  buildMonacoOpportunityWriteBody,
  MONACO_API_BASE,
  mapMonacoOpportunity,
  monacoHeaders,
  parseMonacoCustomFieldInput,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoUpdateOpportunityTool: ToolConfig<
  MonacoUpdateOpportunityParams,
  MonacoOpportunityResponse
> = {
  id: 'monaco_update_opportunity',
  name: 'Monaco Update Opportunity',
  description:
    'Update a Monaco opportunity: rename it, change its owner, move it to another stage or pipeline, or set its estimated value, close dates, notes, or tags. Only the fields you set are changed.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the opportunity to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the opportunity',
    },
    pipelineId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Pipeline to move the opportunity to (see List Pipelines). The stage key then names a stage in that pipeline; if no stage is given, an open opportunity lands on the pipeline's first active stage and a closed one on its first closed stage with the same outcome. If omitted, the opportunity stays in its pipeline.",
    },
    stage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stage key for the opportunity within its pipeline (up to 64 characters; see List Pipelines)',
    },
    stageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Stage ID (from List Pipelines), instead of a stage key. A stage of the opportunity's own pipeline changes its stage; a stage of another pipeline moves the opportunity there.",
    },
    ownerUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to assign as the opportunity owner',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Estimated value as a decimal amount of the currency (e.g. 50000.25). Set together with currencyCode.',
    },
    currencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO 4217 currency code of the estimated value (e.g. USD), up to 8 characters. Set together with amount.',
    },
    estimatedCloseDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expected close date (YYYY-MM-DD)',
    },
    actualCloseDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actual date the opportunity was closed (YYYY-MM-DD)',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes about the opportunity',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Tag IDs for the opportunity, as an array or comma-separated list. Replaces the opportunity's existing tags; send [] to remove them all.",
      items: { type: 'string', description: 'Tag ID' },
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
      `${MONACO_API_BASE}/v1/opportunities/${safeUrlPathSegment(params.opportunityId, 'opportunityId')}`,
    method: 'PATCH',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        ...parseMonacoCustomFieldInput(params.customFields),
        ...buildMonacoOpportunityWriteBody(params),
      }
      if (Object.keys(body).length === 0) throw new Error('Provide at least one field to update')
      return body
    },
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { opportunity: mapMonacoOpportunity(data.data) } }
  },

  outputs: {
    opportunity: {
      type: 'object',
      description: 'The updated opportunity',
      properties: MONACO_OPPORTUNITY_OUTPUT_PROPERTIES,
    },
  },
}
