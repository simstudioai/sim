import type { AffinityCreateListParams, AffinityEntityResponse } from '@/tools/affinity/types'
import { LIST_WITH_TYPE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireOneOf,
  requireParam,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

/** Entity kinds a list can hold. A list's type is fixed at creation. */
const LIST_TYPES = ['company', 'opportunity', 'person'] as const

export const affinityCreateListTool: ToolConfig<
  AffinityCreateListParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_create_list',
  name: 'Affinity Create List',
  description:
    'Create a list. Its type fixes which entities it can hold, and the API key holder becomes its creator and owner.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the new list',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity kind the list holds: company, opportunity, or person',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether everyone in the organization can see the list',
    },
  },

  request: {
    url: () => buildAffinityUrl('/lists'),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: requireParam(params.name, 'name'),
        type: requireOneOf(params.type, LIST_TYPES, 'type'),
      }
      if (params.isPublic !== undefined) body.isPublic = params.isPublic
      return body
    },
  },

  transformResponse: transformEntity(),

  outputs: LIST_WITH_TYPE_OUTPUT_PROPERTIES,
}
