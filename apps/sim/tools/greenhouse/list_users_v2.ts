import type {
  GreenhouseListUsersV2Params,
  GreenhouseListUsersV2Response,
} from '@/tools/greenhouse/types'
import { PAGE_V2_OUTPUTS, USERS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListUsersV2Tool: ToolConfig<
  GreenhouseListUsersV2Params,
  GreenhouseListUsersV2Response
> = {
  id: 'greenhouse_list_users_v2',
  name: 'Greenhouse List Users',
  description: 'Lists one page of users with cursor pagination and documented filters.',
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
    agency_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Agency IDs Comma-separated values (maximum 50).',
    },
    office_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Office IDs Comma-separated values (maximum 50).',
    },
    department_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Department IDs Comma-separated values (maximum 50).',
    },
    linked_candidate_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Linked candidate IDs Comma-separated values (maximum 50).',
    },
    interviewer_tag_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Interviewer tag IDs Comma-separated values (maximum 50).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    employee_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee IDs Comma-separated values (maximum 50).',
    },
    custom_field_option_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field option ID',
    },
    deactivated: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deactivated',
    },
    primary_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary email',
    },
    external_office_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External office ID',
    },
    external_department_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External department ID',
    },
    show_service_accounts: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show service accounts',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('users', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        agency_ids: { type: 'csv', maxItems: 50, integerItems: true },
        office_ids: { type: 'csv', maxItems: 50, integerItems: true },
        department_ids: { type: 'csv', maxItems: 50, integerItems: true },
        linked_candidate_ids: { type: 'csv', maxItems: 50, integerItems: true },
        interviewer_tag_ids: { type: 'csv', maxItems: 50, integerItems: true },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'agency_id',
            'created_at',
            'custom_fields',
            'deactivated',
            'department_ids',
            'emails',
            'employee_id',
            'external_department_ids',
            'external_office_ids',
            'first_name',
            'id',
            'interviewer_tags',
            'job_title',
            'last_name',
            'linked_candidate_ids',
            'name',
            'office_ids',
            'primary_email',
            'site_admin',
            'updated_at',
          ],
        },
        employee_ids: { type: 'csv', maxItems: 50 },
        custom_field_option_id: { type: 'integer' },
        deactivated: { type: 'boolean' },
        primary_email: { type: 'string' },
        external_office_id: { type: 'string' },
        external_department_id: { type: 'string' },
        show_service_accounts: { type: 'boolean' },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        users: rows.map((row) => mapGreenhouseFields(row, USERS_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    users: {
      type: 'array',
      description: 'users on this page',
      items: { type: 'object', properties: { ...USERS_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
