import type {
  GreenhouseListCustomFieldsV2Params,
  GreenhouseListCustomFieldsV2Response,
} from '@/tools/greenhouse/types'
import { CUSTOM_FIELDS_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListCustomFieldsV2Tool: ToolConfig<
  GreenhouseListCustomFieldsV2Params,
  GreenhouseListCustomFieldsV2Response
> = {
  id: 'greenhouse_list_custom_fields_v2',
  name: 'Greenhouse List Custom Fields',
  description: 'Lists one page of custom fields with cursor pagination and documented filters.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque nextCursor from the previous page. When set, all other filters and per_page are ignored.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size from 1 to 500 (default 100). Each call retrieves one page.',
    },
    ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids Comma-separated values (maximum 50).',
    },
    created_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Created at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}. Cannot be combined with updated_at.',
    },
    updated_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Updated at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}. Cannot be combined with created_at.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    field_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field type Allowed: job, opening, standard, offer, compensation_frequency, candidate, referral_question, application, rejection_question, form, agency_question, user_attribute.',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Active',
    },
    name: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Name' },
    name_key: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name key',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('custom_fields', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'active',
            'api_only',
            'application_type',
            'created_at',
            'default_value',
            'description',
            'expose_in_job_board_api',
            'field_type',
            'id',
            'internal_type',
            'name',
            'name_key',
            'placeholder',
            'private',
            'require_approval',
            'required',
            'sort_order',
            'template_token_string',
            'trigger_new_version',
            'updated_at',
            'updated_by_id',
            'use_for_job_approvals',
            'use_for_offer_approvals',
            'value_type',
          ],
        },
        field_type: {
          type: 'string',
          enum: [
            'job',
            'opening',
            'standard',
            'offer',
            'compensation_frequency',
            'candidate',
            'referral_question',
            'application',
            'rejection_question',
            'form',
            'agency_question',
            'user_attribute',
          ],
        },
        active: { type: 'boolean' },
        name: { type: 'string' },
        name_key: { type: 'string' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        custom_fields: rows.map((row) => mapGreenhouseFields(row, CUSTOM_FIELDS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    custom_fields: {
      type: 'array',
      description: 'custom fields on this page',
      items: { type: 'object', properties: { ...CUSTOM_FIELDS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
