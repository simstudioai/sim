import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_OPPORTUNITY_OUTPUT_PROPERTIES,
  type MonacoCreateOpportunityParams,
  type MonacoOpportunityResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoOpportunityWriteBody,
  MONACO_API_BASE,
  mapMonacoOpportunity,
  monacoHeaders,
  parseMonacoCustomFieldInput,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoCreateOpportunityTool: ToolConfig<
  MonacoCreateOpportunityParams,
  MonacoOpportunityResponse
> = {
  id: 'monaco_create_opportunity',
  name: 'Monaco Create Opportunity',
  description:
    'Create a Monaco opportunity on an existing account, optionally setting its pipeline, stage, owner, estimated value, close date, tags, and custom fields.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the opportunity',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the account to associate the opportunity with',
    },
    pipelineId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Pipeline to create the opportunity in (see List Pipelines). If omitted, the organization's default pipeline is used.",
    },
    stage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stage key for the opportunity within its pipeline (up to 64 characters; see List Pipelines). If omitted, the opportunity is placed in the first stage of that pipeline.',
    },
    stageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Stage ID (from List Pipelines), instead of a stage key; provide either stage or stageId, not both. It names the pipeline too, so a pipeline ID, if given, must be that stage's pipeline.",
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
      description: 'Tag IDs to associate with the opportunity, as an array or comma-separated list',
      items: { type: 'string', description: 'Tag ID' },
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom field values as a JSON object keyed by `custom_field_<id>` (e.g. {"custom_field_<id>": "outbound"}). Use Get Field Schemas to find the keys.',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Client-provided UUID that prevents duplicate creation. Reusing a key returns a duplicate_opportunity error naming the opportunity it already created.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/opportunities/`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        ...parseMonacoCustomFieldInput(params.customFields),
        ...buildMonacoOpportunityWriteBody(params),
        account_id: params.accountId.trim(),
      }
      const idempotencyKey = params.idempotencyKey?.trim()
      if (idempotencyKey) body.idempotency_key = idempotencyKey
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
      description: 'The created opportunity',
      properties: MONACO_OPPORTUNITY_OUTPUT_PROPERTIES,
    },
  },
}
