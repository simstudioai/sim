import type {
  AffinityCollectionResponse,
  AffinityListFieldValueChangesParams,
} from '@/tools/affinity/types'
import { FIELD_VALUE_CHANGE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListFieldValueChangesTool: ToolConfig<
  AffinityListFieldValueChangesParams,
  AffinityCollectionResponse<'changes'>
> = {
  id: 'affinity_list_field_value_changes',
  name: 'Affinity List Field Value Changes',
  description:
    'Page through field value changes across the whole workspace. Built for delta sync: follow nextCursor to the end of a run, then resume from the last cursor next time.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Affinity Filtering Language expression over field.id, listEntry.id, changer.id, changedAt, or actionType. Resume a sync with e.g. "changedAt>2026-06-01T12:00:00Z"',
    },
    orderBy: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order: ["changedAt"] for oldest first (the default), ["-changedAt"] for newest first',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous page, returned as nextCursor or prevCursor',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to return per page, 1-100. Defaults to 100',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl('/field-value-changes', {
        filter: params.filter,
        orderBy: parseStringList(params.orderBy, 'orderBy'),
        cursor: params.cursor,
        limit: params.limit,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('changes'),

  outputs: {
    changes: {
      type: 'array',
      description: 'Field value changes across the workspace',
      items: { type: 'object', properties: FIELD_VALUE_CHANGE_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of rows on this page' },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the next page, or null on the last page',
    },
    prevCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the previous page, or null on the first page',
    },
  },
}
